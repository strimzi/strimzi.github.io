---
layout: post
title:  "Hacking Strimzi for Cruise Control"
date: 2019-08-08
author: kyle_liberti
---

Cruise Control is a highly customizable software tool for simplifying the monitoring and balancing of workloads across a Kafka cluster.
The flexibility of Cruise Control makes it easy to customize for different environments and use cases.
This makes it possible to extend Cruise Control to work with Strimzi in an Kubernetes environment with a reasonable amount of effort.
This post will walk through how to hook Cruise Control up to a Strimzi deployed Kafka cluster.
<!--more-->

# Prerequisite Outline

Like any proof of concept, there are a few considerations and tradeoffs to think about before jumping in.
For starters, one will need a Kafka cluster.
At this time of this post, Cruise Control officially supports Kafka version 2.0.0 but should still be compatible with later versions of Kafka.
This blog post will stick to using Kafka version 2.3.0 but feel free to experiment with other Kafka versions.

The core challenges of hacking Cruise Control to work with Strimzi are: 

- Gathering Kafka Metrics for Cruise Control consumption
- Enabling communication between Cruise Control and Zookeeper
- Deploying Cruise Control in Kubernetes

There are many ways of approaching these hurdles but this post will attempt to address these challenges with as few steps as possible.

# Gathering Metrics
In order to estimate partition activity and resources, Cruise Control needs a steady source of metric data from Kafka.
Fortunately, Kafka tracks all sorts of metrics and makes them all accessible through pluggable components known as 'metric reporters'.
Kafka metric reporters designate what, where, when, and how metrics are prepared for export. 

Kafka maintains two core types of metrics:
* **Yammer metrics** For _server-side_ metrics related to brokers.
These metric objects are kept in a globally accessible Yammer metric registry which can be reached directly by metric reporters. 
* **Kafka metrics** For _client-side_ metrics related to Kafka producers, consumers, connect, and streams.
These metric objects are tracked in concurrent hash map and explicitly passed to metric reporters when created.

The type of metrics exposed by the metric reporters, whether it be Yammer metrics, Kafka metrics, or both, is solely dependent on the implementation of the metric reporter.
For example, the JMX metric reporter, a metric reporter provided and automatically enabled by Kafka, only wraps **Kafka metrics** as JMX MBeans.
This is counterintuitive since it's known that Kafka exposes all of its metrics, Kafka *and* Yammer, through JMX.
The reason why the Kafka JMX metric reporter doesn't wrap **Yammer metrics** as MBeans is because they are already exposed as JMX MBeans by Kafka by default.

Upon startup, every Kafka server loops through a list of metric reporters supplied via its Kafka config, executing every metric reporter on its own thread.
As Kafka creates metric objects it passes them to every metric reporter thread for filtering and tracking.
What, where, and how this happens to the metric objects depends on the specific implementation of the metric reporter.
Afterwards, the metric reporters monitor the metric objects for stat updates from Kafka, formatting and storing the changes for future export.

## Cruise Control Metric Reporter
Cruise Control ships its own implementation of a Kafka metric reporter, the 'Cruise Control metric reporter'.
Unlike the JMX metric reporter, the Cruise Control metric reporter filters the metric objects it receives from Kafka, stowing the metric objects related to Kafka partition monitoring into a concurrent hash map.
Then, at user-defined intervals, the reporter will loop through the concurrent hash map and create Cruise Control metric objects from the data provided by the metric objects.
For the Cruise Control metric objects, the reporter will include information related to the metric type, value, time of recording, and broker origin.
Finally, the reporter will format the Cruise Control metric object into a byte array and store it into a Kafka topic designated for Cruise Control metrics.

Placing the Cruise Control metric reporter jar into the '/opt/kafka/libs/' directory of every Kafka broker allows Kafka to find the reporter at runtime.
For the sake of simplicity, one can do this by updating the Strimzi Kafka image with the needed Cruise Control jar using the following Dockerfile:

```Dockerfile
# Multi-stage build requires Docker 17.05 or higher
# --------------- Builder stage ---------------
FROM centos:7 AS builder

ENV CC_VERSION=2.0.57
ENV JAVA_HOME="/usr/lib/jvm/java-1.8.0-openjdk"

RUN yum -y install git java-1.8.0-openjdk-devel

RUN git clone --branch ${CC_VERSION} https://github.com/linkedin/cruise-control.git

RUN cd cruise-control \
    && ./gradlew jar :cruise-control-metric-reporter:jar

# --------------- Final stage ---------------
FROM strimzi/kafka:0.13.0-kafka-2.3.0
COPY --from=builder cruise-control/cruise-control-metrics-reporter/build/libs/* /opt/kafka/libs/
```
Then building and pushing the image:
```bash
# When building, tag the image with the name of a container registry
# that is accessible by the Kubernetes cluster.
docker build . -t <registry>/<kafka-image-name>

# Push the image to that container registry
docker push <registry>/<kafka-image-name>
```
For the Cruise Control metric reporter to be activated at runtime, its class name must be listed in the 'metrics.reporters' field of the Kafka config.
For a Strimzi Kafka cluster, one can do this by creating a Kafka custom resource which references the new Kafka 'image' built above and the 'com.linkedin.kafka.cruisecontrol.metricsreporter.CruiseControlMetricsReporter' class name in the 'metrics.reporters' field using the following 'kafka.yaml' file:
```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    image: <registry>/<kafka-image-name>
    version: 2.3.0
    replicas: 3
    listeners:
      plain: {}
      tls: {}
    config:
      metric.reporters: "com.linkedin.kafka.cruisecontrol.metricsreporter.CruiseControlMetricsReporter"
      offsets.topic.replication.factor: 1
      transaction.state.log.replication.factor: 1
      transaction.state.log.min.isr: 1
      log.message.format.version: "2.3"
    storage:
      type: ephemeral
  zookeeper:
    replicas: 3
    storage:
      type: ephemeral
  entityOperator:
    userOperator: {}
    topicOperator: {}
```
Then applying the Kafka custom resource to the cluster:

```bash
kubectl apply -f kafka.yaml
```
The 'metrics.reporters' field can take a list of comma-separated metric reporter class names.
At runtime, Kafka will loop through this list and instantiate these metric reporters to run concurrently.

At user-defined time windows, Cruise Control will read these reported metrics from the designated Kafka topic and use them for cluster monitoring and balancing.
How to configure the connection between Cruise Control and Kafka will be described later in the post.

# Accessing Zookeeper

Cruise Control relies on Zookeeper for the current state and configuration of the Kafka cluster.
For estimating partition load, monitoring cluster state, and triggering partition reassignments, Cruise Control needs to be able communicate with Zookeeper directly.
By default, communication between Zookeeper and all other Strimzi components must be encrypted and authenticated.
However, using a hack by Jakub Scholz, one can get around this requirement by creating a Kubernetes service which reuses Strimzi certificates to pipe unencrypted and unauthenticated traffic to Zookeeper. This allows Cruise Control to communicate with Zookeeper without the need of proper authorization and encryption configuration via Java system properties or Stunnel sidecars.

```
kubectl apply -f https://gist.githubusercontent.com/scholzj/6cfcf9f63f73b54eaebf60738cfdbfae/raw/068d55ac65e27779f3a5279db96bae03cea70acb/zoo-entrance.yaml
```

**WARNING**: Allowing unauthenticated access to Zookeeper exposes sensitive Kafka metadata for reading and writing by any user.
Nefarious users could exploit this access by altering topic configurations to mess up cluster state or by changing ACL access rules to elevate client privileges for stealing data.

# Deploying Cruise Control

With the Kafka cluster running and the Zookeeper endpoint accessible, Cruise Control can now be started safely and begin sampling metrics and monitoring the cluster.
To run on Kubernetes, Cruise Control must be formatted into a container image.
One can do this using the following Dockerfile. Note that the Cruise Control configuration file, 'cruisecontrol.properties', must be altered to reference the appropriate Kafka bootstrap and Zookeeper service endpoints.
In addition to pointing Cruise Control to the proper service endpoints, the Dockerfile sets up the Cruise Control GUI frontend to be available upon startup.

```Dockerfile
# Multi-stage build requires Docker 17.05 or higher
# --------------- Builder stage ---------------
FROM centos:7 AS builder

ENV CC_VERSION=2.0.57
ENV JAVA_HOME=/usr/lib/jvm/java-1.8.0-openjdk

RUN yum -y install git java-1.8.0-openjdk-devel

RUN git clone --branch ${CC_VERSION} https://github.com/linkedin/cruise-control.git

WORKDIR cruise-control

# Compile and remove leftover directories
RUN ./gradlew jar :cruise-control:jar  \
    && rm -rf cruise-control-core cruise-control-metrics-reporter cruise-control-client

# Configure Cruise Control to point to the proper Kafka and Zookeeper endpoints
RUN sed -i 's/bootstrap.servers=.*/bootstrap.servers=my-cluster-kafka-bootstrap:9092/g' config/cruisecontrol.properties \
    && sed -i 's/zookeeper.connect=.*/zookeeper.connect=zoo-entrance:2181/g' config/cruisecontrol.properties \
    && sed -i 's/capacity.config.file=.*/capacity.config.file=config\/capacityJBOD.json/g' config/cruisecontrol.properties \
    && sed -i 's/sample.store.topic.replication.factor=.*/sample.store.topic.replication.factor=1/g' config/cruisecontrol.properties

# Install Cruise Control GUI Frontend
RUN curl -L https://github.com/linkedin/cruise-control-ui/releases/download/v0.1.0/cruise-control-ui.tar.gz \
    -o /tmp/cruise-control-ui.tar.gz \
    && tar zxvf /tmp/cruise-control-ui.tar.gz

# --------------- Final stage ---------------
FROM centos:7
WORKDIR cruise-control

RUN yum -y install java-1.8.0-openjdk && \
    yum clean all -y

COPY --from=builder cruise-control .

# Ensure Cruise Control writable for logs
RUN chmod a+rw -R .

ENTRYPOINT ["/bin/bash", "-c", "./kafka-cruise-control-start.sh config/cruisecontrol.properties"]
```
Build and push the image:
```bash
# When building, tag the image with the name of a container registry
# that is accessible by the Kubernetes cluster.
docker build . -t <registry>/<cruise-control-image-name>

# Push the image to that container registry
docker push <registry>/<cruise-control-image-name>
```
Then, using the following file, 'cruise-control-deployment.yaml', create a Cruise Control deployment that references the Cruise Control image, 'cruise-control-image-name', and a Cruise Control service endpoint for enabling communication with Cruise Control from outside the Cruise Control pod.
```yaml
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: my-cruise-control
  labels:
    app: cruise-control
spec:
  replicas: 1
  template:
    metadata:
      labels:
        app: cruise-control
        name: my-cruise-control
    spec:
      containers:
      - name: my-cruise-control
        image: <registry>/<cruise-control-image-name>
        imagePullPolicy: 'Always'
---
apiVersion: v1
kind: Service
metadata:
  labels:
    app: cruise-control
    name: my-cruise-control
  name: my-cruise-control
spec:
  ports:
    - name: http-9090
      port: 9090
      protocol: TCP
      targetPort: 9090
  type: ClusterIP
  selector:
    name: my-cruise-control
```
Apply to the cluster:
```bash
kubectl apply -f cruise-control-deployment.yaml
```

# Interacting with Cruise Control API

After Cruise Control is up and running, one can access the Cruise Control REST API from outside Kubernetes by port forwarding the Cruise Control service to 'localhost:9090'

```
kubectl port-forward svc/my-cruise-control 9090:9090
```

After forwarding the service, there are a few ways to interact with the Cruise Control API:

* curl
* cruise-control client
* Cruise Control GUI Frontend

## Using curl

```
curl -vv -X GET "http://127.0.0.1:9090/kafkacruisecontrol/state"
```

For more details visit the [Cruise Control Wiki](https://github.com/linkedin/cruise-control/wiki/REST-APIs)


## Using Cruise Control Python client

To install:

```
pip3 install cruise-control-client
```

To run:

```
cccli -a 127.0.0.1:9090  kafka_cluster_state
```

For more details visit the [Cruise Control Wiki](https://github.com/linkedin/cruise-control/wiki/Getting-Started)


## Using Cruise Control Frontend

Vist 'http://127.0.0.1:9090' in browser

![Cruise Control Frontend]({{ "/assets/2019-08-08-cruise-control-frontend.png" }})

# Conclusion

After gathering enough metric samples, Cruise Control will be able estimate partition resources.  Knowing the the partition load, Cruise Control will be able to evaluate whether any resource restrictions have been violated and propose more efficient partition assignments for the cluster.
Just like metric reporters, many of the Cruise Control's components can be tailored to fit special use cases and environments.
Components that determine things like how resources are calculated, what resource goals are prioritized, and how anomalies are handled can all be customized by the user.
This flexibility gives users the leverage to operate their Kafka clusters more effectively, even while using Strimzi.
In one of the future versions, the Strimzi community hopes to make this even easier by supporting Cruise Control directly from the Strimzi Operator, but until then, hack away!

# Acknowledgements

The core content of this post is based upon the work of Adam Cattermole.
Not only did Adam get Cruise Control working with Strimzi but he also shared [all the steps, Dockerfiles, and YAML files](https://github.com/adam-cattermole/cc-extra/blob/master/notes.adoc) for others to do so as well.

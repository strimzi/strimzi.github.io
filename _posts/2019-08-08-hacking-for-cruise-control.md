---
layout: post
title:  "Hacking Strimzi for Cruise Control"
date: 2019-08-08
author: kyle_liberti
---

Cruise Control is a higly customizable Kafka partition balancing and monitoring software run in production at Linkedin. Cruise Control’s component pluggability makes it flexible to customize for different environments. This makes it possible to extend Cruise Control to work with Strimzi in an Kubernetes environment with a reasonable amount of effort. This post will walk through how to get Cruise Control working with a Stimzi deployed Kafka cluster.
<!--more-->

# Prequisite Outline

Like any proof of concept, there are a few actions to consider when putting it together. For getting Cruise Control to work with Strimzi these actions are: 

- Aligning Kafka versions
- Gathering Kafka Metrics
- Accessing Zookeeper
- Deploying Cruise Control

# Aligning Kafka versions

At this time of this post, Cruise Control officially supports Kafka version 2.0.0 but should still be compatible with later versions of Kafka. This blog post will stick to using Kafka version 2.3.0 but feel free to experiment with other Kafka versions.

# Gathering Metrics
In order to estimate partition activity and resources, Cruise Control needs a steady source of metric data from Kafka. Fortunately, Kafka tracks all sorts of metrics and makes them all accessible through pluggable components know as 'metric reporters'. Kafka metric reporters designate what, where, when, and how metrics are prepared for export. 

Kafka maintains two core types of metrics:
* **Yammer metrics** For _server-side_ metrics related to brokers. These metric objects are kept in a globally accessible Yammer metric registry which can be reached directly by metric reporters. 
* **Kafka metrics** For _client-side_ metrics related to Kafka producers, consumers, connect, and streams. These metric objects are tracked in concurrent hash map and explicitely passed to metric reporters when created. 

The type of metrics exposed by the metric reporters, whether it be Yammer metrics, Kafka metrics, or both, is solely dependent on the implementation of the metric reporter. For example, the JMX metric reporter, a metric reporter provided and automatically enabled by Kafka, only wraps **Kafka metrics** as JMX MBeans. This is counterintuitve since it's known that Kafka exposes all of its metrics, Kafka *and* Yammer, through JMX. The reason why the Kafka JMX metric reporter doesn't wrap **Yammer metrics** as MBeans is because they are already exposed as JMX MBeans through Kafka by default.

Upon startup, every Kafka server loops through a list of metric reporters supplied via its Kafka config, executing every metric reporter on its own thread. As Kafka creates metric objects it passes them to the metric reporters threads for filtering and tracking. What, where, and how this happens to the metric objects depends on the specific implementation of the metric reporter. Afterwards, the metric reporters monitor the metric objects for stat updates from Kafka, formating and storing the changes for future export.

## Cruise Control Metric Reporter
Cruise Control ships its own implementation of a Kafka metric reporter, the 'Cruise Control metric reporter'. Unlike the JMX metric reporter, the Cruise Control metric reporter filters the metric objects it receives from Kafka, stowing the metric objects related to Kafka partition monitoring into a concurrent hash map. Then, at user-defined intervals, the reporter will loop through the concurrent hash map and create Cruise Control metric objects from the data provided by the metric objects. For the Cruise Control metric objects, the reporter will include information related to the the metric type, metric value, time of recording, and broker origin. Finally, the reporter will format the Cruise Control metric object into a byte array and store it into a Kafka topic designated for Cruise Control metrics.

Placing the Cruise Control metric reporter jar into the '/opt/kafka/libs/' directory of every Kafka broker allows Kafka to find the reporter at runtime. For the sake of simplicity, one can do this by updating the Strimzi Kafka image with the needed Cruise Control jar using the following Dockerfile:

```Dockerfile
FROM strimzi/kafka:0.13.0-kafka-2.3.0

ENV CC_VERSION=2.0.57
ENV JAVA_HOME="/usr/lib/jvm/java-1.8.0-openjdk"

USER root

RUN yum -y install git java-1.8.0-openjdk-devel \
    && yum clean all -y

RUN git clone --branch ${CC_VERSION} https://github.com/linkedin/cruise-control.git

RUN cd cruise-control \
    && ./gradlew jar :cruise-control-metric-reporter:jar \
    && cp cruise-control-metrics-reporter/build/libs/* /opt/kafka/libs/
```
Then build the image:
```bash
docker build . -t <kafka-image-name>
```
For the Cruise Control metric reporter to be activated at runtime, its class name must be listed in the 'metrics.reporters' field of the Kafka config. For a Strimzi Kafka cluster, one can do this by creating a Kafka custom resource which references the new Kafka 'image' built above and the 'com.linkedin.kafka.cruisecontrol.metricsreporter.CruiseControlMetricsReporter' class name in the 'metrics.reporters' field using the following 'kafka.yaml' file:
```yaml
apiVersion: kafka.strimzi.io/v0alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    image: <kafka-image-name>
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
      log.message.format.version: "2.3.0"
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
Then apply the Kafka custom resource to the cluster:

```bash
kubectl apply -f kafka.yaml
```
The 'metrics.reporters' field can take a list of comma-separated metric reporter package names. At runtime, Kafka will loop through this list and instantiate these metric reporters to run concurrently.

# Accessing Zookeeper

Cruise Control relies on Zookeeper for the current state and configuration of the Kafka cluster. For estimating partition load, monitoring cluster state, and triggering partition reassignments, Cruise Control needs to be able communicate with Zookeeper directly. By default, communication between Zookeeper and all other Strimzi components must be encrypted and authenticated. However, using a hack by Jakub Scholz, one can get around this requirement by creating a Kubernetes service which reuses Strimzi certificates to pipe unencrypted and unauthenticated traffic to Zookeeper. This allows Cruise Control to communicate with Zookeeper without the need of proper authorization and encryption configuration via Java system properties or Stunnel sidecars.

```
kubectl apply -f https://gist.githubusercontent.com/scholzj/6cfcf9f63f73b54eaebf60738cfdbfae/raw/068d55ac65e27779f3a5279db96bae03cea70acb/zoo-entrance.yaml
```

**WARNING**: Allowing unauthenticated access to Zookeeper exposes sensitive Kafka metadata for reading and writing by any user. Nefarious users can exploit this access by altering topic configurations to mess up the state of the cluster or by changing ACL access rules to elevate client privileges to steal data.

# Deploying Cruise Control

To run on Kuberentes, Cruise Control must be formatted into a container image. One can do this using the following Dockerfile. Note that the Cruise Control configuration file, 'cruisecontrol.properties', must be altered to reference the appropriate Kafka bootstrap and Zookeeper service endpoints. In addition to pointing Cruise Control to the proper service endpoints, the Dockerfile sets up the Cruise Control GUI fontend to be available upon Cruise Control startup.

```Dockerfile
FROM centos:7

ENV CC_VERSION=2.0.57
ENV JAVA_HOME=/usr/lib/jvm/java-1.8.0-openjdk

RUN yum -y install git java-1.8.0-openjdk-devel && \
    yum clean all -y

RUN git clone --branch ${CC_VERSION} https://github.com/linkedin/cruise-control.git

WORKDIR cruise-control

RUN ./gradlew jar copyDependantLibs

# Configure Cruise Control to point to the proper Kafka and Zookeeper endpoints
RUN sed -i 's/bootstrap.servers=.*/bootstrap.servers=my-cluster-kafka-bootstrap:9092/g' config/cruisecontrol.properties \
    && sed -i 's/zookeeper.connect=.*/zookeeper.connect=zoo-entrance:2181/g' config/cruisecontrol.properties \
    && sed -i 's/capacity.config.file=.*/capacity.config.file=config\/capacityJBOD.json/g' config/cruisecontrol.properties \
    && sed -i 's/sample.store.topic.replication.factor=.*/sample.store.topic.replication.factor=1/g' config/cruisecontrol.properties 

# Ensure Cruise Control log directory is writable
RUN mkdir logs \ 
    && touch ./logs/kafkacruisecontrol.log \
    && chmod a+rw -R .

# Install Cruise Control GUI Frontend
RUN curl -L https://github.com/linkedin/cruise-control-ui/releases/download/v0.1.0/cruise-control-ui.tar.gz \
    -o /tmp/cruise-control-ui.tar.gz \
    && tar zxvf /tmp/cruise-control-ui.tar.gz

ENTRYPOINT ["/bin/bash", "-c", "./kafka-cruise-control-start.sh config/cruisecontrol.properties"]
```
Build the image:
```
docker build . -t <cruise-control-image-name>
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
        image: <cruise-control-image-name>
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
  type: NodePort
  selector:
    name: my-cruise-control

```
Apply to the cluster:
```bash
kubectl apply -f cruise-control-deployment.yaml
```

# Interacting with Cruise Control API

After the Cruise Control is up and running, one can access the Cruise Control REST API from outside Kubernetes by port forwarding the Cruise Control service to 'localhost:9090'

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

Sampling Cruise Control metrics from the Kafka cluster, Cruise Control will calculate the partition resources and evaluate whether any cluster goals or resource restrictions have been violated. Upon violation, Cruise Control will notify the users when it needs manual intervention whether it be a partition rebalance, an additional broker, or configuration adjustment. Just like the metric reporter, the components that determine things like resource calculations, partition restrictions, and violation alerts are customizable. This flexibility gives users the leverage to operate their Kafka clusters more effectively, even while using Strimzi.

# Acknowledgements

The core content of this post is based upon the work of Adam Cattermole. Not only did Adam get Cruise Control working with Strimzi but he also provided [all the steps, Dockerfiles, and YAML files](https://github.com/adam-cattermole/cc-extra/blob/master/notes.adoc) for others to do so as well.

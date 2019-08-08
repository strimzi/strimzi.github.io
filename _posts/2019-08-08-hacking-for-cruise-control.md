---
layout: post
title:  "Hacking Strimzi for Cruise Control"
date: 2019-08-08
author: kyle_liberti
---

Cruise Control is a higly customizable Kafka partition balancing and monitoring software run in production at Linkedin. Cruise Controls’s component pluggability makes it flexible to customize for different environments. This makes it possible to extend Cruise Control to work with Strimzi in an Kubernetes environment with a reasonable amount of effort. This post will walk through how to get Cruise Control working with a Stimzi deployed Kafka cluster.

# Prequisite Outline

Like any proof of concept, there are a few actions to consider when putting it together. For getting Cruise Control to work with Strimzi these actions are: 

- Aligning Kafka versions
- Gathering Kafka Metrics
- Accessing Zookeeper endpoint
- Containerizing and deploying Cruise Control

# Aligning Kafka versions

Its worth noting that the latest Kafka version which Cruise Control supports at this time is 2.0.1. The latest version of Strimzi which supports Kafka version 2.0.1 is 0.11.4. Although its possible to run Cruise Control alongside with later versions of Kafka, 2.0.1+, it is not supported. Keep this in mind when deciding which version of Strimzi to deploy. This post will stick to using Strimzi 0.11.4, but feel free to experiment with more updated versions.  

# Gathering Metrics

In order to estimate partition activity and resources, Cruise Control needs to a steady source of raw metrics from Kafka. Cruise Control also needs a method of processing and a place of storing these raw metrics as well. Luckily, Cruise Control ships with an implemenation of a Kafka Metrics Reporter which takes care of these things. Making this metric sampler available to Strimzi Kafka brokers requires creating a new Kafka image and placing the metrics reporter in the `/opt/kafka/libs/` directory.

First create a Dockerfile like this:
```Dockerfile
FROM strimzi/kafka:0.11.4-kafka-2.0.1

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

Create a basic Kafka resource, `kafka.yaml`, then specify the Cruise Control metrics reporter in the Kafka `metrics.reporters` config:
```yaml
apiVersion: kafka.strimzi.io/v0alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    image: <kafka-image-name>
    version: 1.0.1
    replicas: 2
    listeners:
      plain: {}
      tls: {}
    config:
      metric.reporters: "com.linkedin.kafka.cruisecontrol.metricsreporter.CruiseControlMetricsReporter"
      offsets.topic.replication.factor: 0
      transaction.state.log.replication.factor: 0
      transaction.state.log.min.isr: 1
      log.message.format.version: "1.0.1"
    storage:
      type: ephemeral
  zookeeper:
    replicas: 2
    storage:
      type: ephemeral
  entityOperator:
    userOperator: {}
    topicOperator: {}
```

```bash
oc apply -f kafka.yaml
```
# Accessing Zookeeper

Be default, communication between Zookeeper and all other Strimzi components must be encrytped. Using a hack by Jakub Scholz, one can create a Kubernetes service which reuses the Strimzi certs to pipe unecrypted Cruise Control traffic through to Zookeeper. This removes the need to include traffic encryting sidecars in the Cruise Control deployment.

```
kubectl apply -f https://gist.githubusercontent.com/scholzj/6cfcf9f63f73b54eaebf60738cfdbfae/raw/068d55ac65e27779f3a5279db96bae03cea70acb/zoo-entrance.yaml
```

# Containerizing and deploying Cruise Control

Create a Cruise Control image

```Dockerfile
FROM centos:7

ENV CC_VERSION=2.0.57
ENV JAVA_HOME=/usr/lib/jvm/java-1.8.0-openjdk

RUN yum -y install git java-1.8.0-openjdk-devel && \
    yum clean all -y

RUN git clone --branch ${CC_VERSION} https://github.com/linkedin/cruise-control.git

WORKDIR cruise-control

RUN ./gradlew jar copyDependantLibs

RUN sed -i 's/bootstrap.servers=.*/bootstrap.servers=my-cluster-kafka-bootstrap:9092/g' config/cruisecontrol.properties \
    && sed -i 's/zookeeper.connect=.*/zookeeper.connect=zoo-entrance:2181/g' config/cruisecontrol.properties \
    && sed -i 's/capacity.config.file=.*/capacity.config.file=config\/capacityJBOD.json/g' config/cruisecontrol.properties \
    && sed -i 's/sample.store.topic.replication.factor=.*/sample.store.topic.replication.factor=1/g' config/cruisecontrol.properties 
   
RUN mkdir logs \ 
    && touch ./logs/kafkacruisecontrol.log \
    && chmod a+rw -R .

RUN curl -L https://github.com/linkedin/cruise-control-ui/releases/download/v0.1.0/cruise-control-ui.tar.gz \
    -o /tmp/cruise-control-ui.tar.gz \
    && tar zxvf /tmp/cruise-control-ui.tar.gz

ENTRYPOINT ["/bin/bash", "-c", "./kafka-cruise-control-start.sh config/cruisecontrol.properties"]
```

```
docker build . -t <cruise-control-image-name>
```

Then create a Cruise Control deployment, `cruise-control-deployment.yaml`
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

```bash
oc apply -f cruise-control-deployment.yaml
```

# Interacting with Cruise Control API

To access the Cruise Control REST API from outside out OKD, port-forward the Cruise Control service to localhost:9095:

```
oc port-forward svc/my-cruise-control 9095:9090
```

After port forwarding the service, there are a few ways to interact with the Cruise Control API:

* curl
* cruise-control client
* Cruise Control GUI Frontend

## Using Curl

```
curl -vv -X GET -c /tmp/mycookie-jar.txt "http://127.0.0.1:9095/kafkacruisecontrol/state"
```

For more details visit the [Cruise Control Wiki](https://github.com/linkedin/cruise-control/wiki/REST-APIs)


## Using Cruise Control Python client

To install:

```
pip3 install cruise-control-client
```

To run:

```
cccli -a 127.0.0.1:9095  kafka_cluster_state
```

## Using Cruise Control Frontend

Vist `http://127.0.0.1:9095` in browser

![Cruise Control Frontend]({{ "/assets/2019-08-08-cruise-control-frontend.png" }})

# Citations

Don't forget to cite Adam Cattermole

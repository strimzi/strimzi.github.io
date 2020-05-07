---
layout: post
title:  "Using the Apache Camel Kafka Connectors with Strimzi"
date: 2020-05-07
author: sjwoodman
---

The Apache Camel project has just [released](https://camel.apache.org/blog/Camel-Kafka-connector-release-0.1.0/) a set of connectors which can be used to leverage the broad ecosystem of Camel in Kafka Connect. 
Apache Camel is the leading Open Source integration framework enabling users to connect to applications which consume and produce data. 
Camel enables a wide range of enterprise integration patterns and has connectors for over 300 different systems - from ActiveMQ to ZooKeeper.  

![Camel and Strimzi](/assets/images/posts/2020-05-07-CamelandStrimziLogos.png)

<!--more-->

It is true that a range of connectors already exist for Kafka Connect but these vary in maturity and license. 
Some are mature and well maintained, whereas others lack provenance and there is little effort in standardising on configuration options. 
The new Camel Kafka connectors offer new options - the ability to connect to a wealth of external applications with the maturity and maintenance which comes from the Camel community. 

Using these connectors with Strimzi is made easy by using the Kafka Connector Operator which was released in Strimzi 0.16. 
Assuming you already have a Strimzi cluster running, there are three steps which are needed. 

In this example we will use the Camel Kafka Connector for the Telegram instant messaging service - a [full list of the available connectors](https://camel.apache.org/camel-kafka-connector/latest/connectors.html) is in the documentation. 
The example will consume messages sent to a Telegram app and forward them to a Kafka topic. 

### Add the Camel Telegram Connector to the Kafka Connect image

Download the [latest version](https://repo1.maven.org/maven2/org/apache/camel/kafkaconnector/camel-telegram-kafka-connector/0.1.0/camel-telegram-kafka-connector-0.1.0-package.tar.gz) of the Camel Telegram Connector from Maven Central (0.1.0 at the time of writing).

Note: This will build a Kafka Connect image with just the Camel Telegram Connector in. It is also possible to [build an image](https://camel.apache.org/camel-kafka-connector/latest/try-it-out-on-openshift-with-strimzi.html) which contains all of the Camel Connectors. This involves building from the source and results in a larger image. However, it does have the benefit of being able to use a single Connect image to interact with multiple external systems.

Add the connectors to the Kafka Connect by creating a new image from this dockerfile. If you are running on OpenShift you can use the [Connect S2I feature](https://camel.apache.org/camel-kafka-connector/latest/try-it-out-on-openshift-with-strimzi.html) instead of this step.

```bash
cat <<EOF >Dockerfile
FROM strimzi/kafka:0.17.0-kafka-2.4.0
USER root:root
RUN mkdir -p /opt/kafka/plugins/camel
COPY ./camel-telegram-kafka-connector-0.1.0-package.tar.gz /opt/kafka/plugins/camel/
RUN tar -xvzf /opt/kafka/plugins/camel/camel-telegram-kafka-connector-0.1.0-package.tar.gz --directory /opt/kafka/plugins/camel
RUN rm /opt/kafka/plugins/camel/camel-telegram-kafka-connector-0.1.0-package.tar.gz
USER 1001
EOF
```

Next, build the image. 

```bash
docker build . -t <docker-org>/camel-kafkaconnect
docker push <docker-org>/camel-kafkaconnect
```

### Start a Kafka Connect Cluster with the Operator managing the Connectors. 

Telegram requires a token to authenticate to the API. 
Other connectors may require usernames and passwords or different types of keys. 
It is possible to include these directly in the KafkaConnector CustomResource. 
However, that is clearly not very secure as any user who has read access to the CustomResource could extract the credentials. 
In order to secure the token we will add it to a Kubernetes `Secret` which will be mounted into the Connector pods. 

Note: For instructions on how to create a bot and API key see the [Telegram documentation](https://core.telegram.org/bots).

```bash
cat <<EOF > telegram.properties
token: <token>
EOF
kubectl -n kafka create secret generic telegram-credentials \
  --from-file=telegram.properties
```

Strimzi provides two options for managing Kafka Connectors - either the Connect REST API or via an Operator. 
We will use the latter so need to add the `strimzi.io/use-connector-resources: "true"` annotation to the `KafkaConnect` CustomResource which enables this mode. 
The secret will be loaded using Kafka's `config.providers` mechanism so set the `spec.config.config.providers.file.class` to the `FileConfigProvider`. 
Strimzi will take care of loading the secret into the container based on the `externalConfiguration` section of the CustomResource.

Make sure to replace the `spec.image` with the image you built in the previous step.

```bash
cat <<EOF | kubectl -n kafka apply -f -
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaConnect
metadata:
  name: my-connect-cluster
  annotations:
    strimzi.io/use-connector-resources: "true"
spec:
  image: <docker-org>/camel-kafkaconnect
  replicas: 1
  bootstrapServers: my-cluster-kafka-bootstrap:9093
  tls:
    trustedCertificates:
      - secretName: my-cluster-cluster-ca-cert
        certificate: ca.crt
  config:
    config.storage.replication.factor: 1
    offset.storage.replication.factor: 1
    status.storage.replication.factor: 1
    config.providers: file
    config.providers.file.class:  org.apache.kafka.common.config.provider.FileConfigProvider
  externalConfiguration:
    volumes:
      - name: connector-config
        secret:
          secretName: telegram-credentials
EOF
```

### Configure and Deploy the Connector

Kafka Connect is now running (you can inspect the CustomResources or logs with the usual `kubectl get kakfaconnect …` commands).

The final step is to configure the Telegram connector. 
Kafka Connects supports message transformations and this Connector has been configured to extract the text from the Telegram message and transform it into a String. 
The authorisation token has also been added as a reference to the file which will be mounted into the pod by the Operator.


```bash
cat <<EOF | kubectl -n kafka apply -f - 
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaConnector
metadata:
  name: telegram-connector
  labels:
    strimzi.io/cluster: my-connect-cluster
spec:
  class: org.apache.camel.kafkaconnector.CamelSourceConnector
  tasksMax: 1
  config:
    key.converter: org.apache.kafka.connect.storage.StringConverter
    value.converter: org.apache.kafka.connect.storage.StringConverter
    camel.source.kafka.topic: telegram-topic
    camel.source.url: telegram:bots
    camel.component.telegram.authorizationToken: ${file:/opt/kafka/external-configuration/connector-config/telegram.properties:token}
    transforms: telegram
    transforms.telegram.type: org.apache.camel.kafkaconnector.transforms.CamelTypeConverterTransform$Value
    transforms.telegram.target.type: java.lang.String
EOF
```

Now that the connector is deployed it is time to test it. 
Navigate to your Bot in Telegram and send it some messages:

These messages will be consumed by the Telegram Connector and forwarded to the `telegram-topic` Kafka Topic. In this example, Strimzi has not been configured to enable external access, but a consumer can be run inside the cluster.

```bash
kubectl -n kafka exec my-cluster-kafka-0 -c kafka -i -t --   bin/kafka-console-consumer.sh     --bootstrap-server localhost:9092     --topic telegram-topic

Kafka + Kubernetes = Strimzi
Strimzi is awesome!
Camel is amazing!
```

Each message that has been sent to the Telegram bot has been read by the Camel Telegram Connector and produced to the `telegram-topic`. 
The connector has extracted the message text in the Connector before putting the message onto the Kafka topic. 
These messages can now be consumed by whichever applications are interested in them, enabling further processing or filtering. 
If the transform had not been applied, the entire message including all the headers would have been sent to Kafka. 
Future versions of the Camel Kafka Connectors will support additional options such as converting the messages into JSON and other formats.

This post has shown how it is possible to use the Camel Kafka Connectors with Strimzi to connect to third party systems. 
It was not necessary to write any code or send any cURL requests, simply include the jars in the Kafka Connect image and configure using CustomResources. 
With over [300 connectors available](https://camel.apache.org/camel-kafka-connector/latest/connectors.html), the Camel Kafka Connect project provides connectivity to most popular applications. 
The project is moving very quickly, continually adding features which will enhance the Kafka ecosystem.



 

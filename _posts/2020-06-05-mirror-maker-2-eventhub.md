---
layout: post
title:  "Mirroring to Azure Event Hub evolution: using Mirror Maker 2"
date: 2020-06-05
author: paolo_patierno
---

In the [previous blog post](https://strimzi.io/blog/2020/05/14/mirror-kafka-eventhub/) we talked about mirroring data from an Apache Kafka cluster running on Kubernetes to Azure Event Hub, using the first version of Mirror Maker.
With Apache Kafka 2.4.0, Mirror Maker 2 was released in order to overcome the limitations of Mirror Maker and adding more powerful features.
This blog post is a continuation of the previous one and it's going to show how to use the Strimzi cluster operator to configure and deploy Kafka Mirror Maker 2 in order to mirror topics to Azure Event Hub.
It's not going to show everything from scratch but we assume that your Kafka cluster is already running and you have already created an Azure Eveng Hub namespace.
If you want to know more about Mirror Maker 2 and its integration with Strimzi, you can read this [blog post](https://strimzi.io/blog/2020/03/30/introducing-mirrormaker2/).
Anyway, the source code is available at this [repo](https://github.com/ppatierno/strimzi-eventhub).

<!--more-->

## Prerequisites

Let's assume that your Apache Kafka cluster is already running on Kubernetes, in the `kafka` namespace, and you already have created the corresponding Azure Event Hub namespace.
The overall architecture with Kafka producer and consumer on both sides looks like the following. 

![Overall architecture](/assets/images/posts/2020-06-05-mirror-maker-2-eventhub.png)

The topic we want to mirror data is described trough the following `KafkaTopic` resource and it's named `testeh`.

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaTopic
metadata:
  name: testeh
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 1
  replicas: 1
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
```

Save it in the `kafka-topic.yaml` file and create the topic on the Kubernetes cluster.

```shell
kubectl apply -f kafka-topic.yaml -n kafka
```

The Strimzi topic operator takes care of this custom resource, creating the topic in the Apache Kafka cluster.

For authenticating to the Azure Event Hub namespace, the following snippet shows the endpoint that has to be customized with the actual Event Hub connection string; save this `Secret` in a file named `eventhubs-secret.yaml`

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: eventhubssecret
type: Opaque
stringData:
  eventhubspassword: Endpoint=sb://<eventhubs-namespace>.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=<access-key>
```

Create the `Secret` on the Kubernetes cluster.

```shell
kubectl apply -f eventhubs-secret.yaml -n kafka
```

### Configure Kafka Mirror Maker 2

The Kafka Mirror Maker 2 instance is deployed via the Strimzi cluster operator through a corresponding `KafkaMirrorMaker2` resource as the following.

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
  name: my-mm2-cluster
spec:
  version: 2.5.0
  replicas: 1
  connectCluster: "eventhub"
  clusters:
  - alias: "my-cluster"
    bootstrapServers: my-cluster-kafka-bootstrap:9092
  - alias: "eventhub"
    bootstrapServers: <eventhubs-namespace>.servicebus.windows.net:9093
    config:
      config.storage.replication.factor: 1
      offset.storage.replication.factor: 1
      status.storage.replication.factor: 1
      producer.connections.max.idle.ms: 180000
      producer.metadata.max.age.ms: 180000
    authentication:
      type: plain
      username: $ConnectionString
      passwordSecret:
        secretName: eventhubssecret
        password: eventhubspassword
    tls:
      trustedCertificates: []
  mirrors:
  - sourceCluster: "my-cluster"
    targetCluster: "eventhub"
    sourceConnector:
      config:
        replication.factor: 1
        offset-syncs.topic.replication.factor: 1
        sync.topic.acls.enabled: "false"
    heartbeatConnector:
      config:
        heartbeats.topic.replication.factor: 1
    checkpointConnector:
      config:
        checkpoints.topic.replication.factor: 1
    topicsPattern: ".*"
    groupsPattern: ".*"
```

It has to connect to the clusters through the related `bootstrapServers` connections that are described in the `clusters` section.
The first one, "my-cluster" is the Apache Kafka cluster running on Kubernetes; the other one, "eventhub" is the Azure Event Hub namespace.
In this example, there is no need for a special configuration for the local source cluster but we need more for the Azure Event Hub.

The connection to the Event Hub namespace is based on TLS and PLAIN authentication using `$ConnectionString` as username and the connection string as password provided in the already created `eventhubssecret`.
The `tls` section is used because Event Hub connection [needs SSL](https://docs.microsoft.com/en-gb/azure/event-hubs/event-hubs-for-kafka-ecosystem-overview?WT.mc_id=devto-blog-abhishgu#security-and-authentication) with `SASL_SSL` as security protocol

While working with this configuration, I noticed that after a period of inactivity, so not sending messages as a steady stream, the mirroring suddenly stopped to work after a few minutes.
After some research and multiple tries, it turned out that it's really important to set the configuration of `connections.max.idle.ms` and `metadata.max.age.ms`, for the producer, with a value less than 4 minutes.
You could ask ... from where does this "magic" value come ?
This is related to the behaviour of the Azure load balancers, in front of the Eveng Hub, which have an idle timeout setting of 4 minutes to 30 minutes.
By default, it is set to 4 minutes.
If a period of inactivity is longer than the timeout value, there's no guarantee that the TCP ession is maintained between the client and the cloud service.
You can find more information on the official Microsoft [documentation](https://docs.microsoft.com/en-us/azure/load-balancer/load-balancer-tcp-idle-timeout#tcp-idle-timeout).

The recommended configuration parameters for connecting to Azure Event Hub are also described [here](https://github.com/Azure/azure-event-hubs-for-kafka/blob/master/CONFIGURATION.md).

The `mirrors` section describes what has to be mirrored and what should be the flow.
In this case, the local "my-cluster" is the source and the "eventhub" is the target.

Kafka Mirror Maker 2 is based on Kafka Connect and it uses a bunch of connectors for doing the mirroring, the heartbeating and the checkpointing.
The `sourceConnector` is a specific Kafka Connect connector actually doing the mirroring, so reading from the local source cluster and making the messages available to Kafka Connect in order to mirror them to Azure Event Hub.
The `heartbeatConnector` periodically checks connectivity between clusters.
The `checkpointConnector` tracks and maps offsets for specified consumer groups using an offset sync topic and checkpoint topic.

Create the `KafkaMirrorMaker2` on the Kubernetes cluster saving the above resource into a `kafka-mirror-maker-2-to-eh.yaml` file.
The Strimzi cluster operator takes care of it deploying Kafka Mirror Maker 2 using the above configuration.

```shell
kubectl apply -f kafka-mirror-maker-2-to-eh.yaml -n kafka
```

### Produce, mirror and consume!

For the purpose of this demo, the application consuming the mirrored messages from Azure Event Hub is the simple `kafka-console-consumer` command line tool, provided with Apache Kafka, which needs a proper configuration as described below.

```
bootstrap.servers=<eventhubs-namespace>.servicebus.windows.net:9093
security.protocol=SASL_SSL
sasl.mechanism=PLAIN
sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="$ConnectionString" password="Endpoint=sb://<eventhubs-namespace>.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=<access-key>";
```

Save the above properties into a `kafka_eventhub.properties` file and start the consumer as following.

```shell
bin/kafka-console-consumer.sh --bootstrap-server <eventhubs-namespace>.servicebus.windows.net:9093 --topic testeh --consumer.config kafka_eventhub.properties
```

To try the entire pipeline, the only thing left to do is to send some messages.
To do so, just use the `kafka-console-producer` command line tool provided with Apache Kafka.
Start a new pod in the Kubernetes cluster for hosting the producer and type a couple of messages as follows.

```shell
kubectl -n kafka run kafka-producer -ti --image=strimzi/kafka:0.18.0-kafka-2.5.0 --rm=true --restart=Never -- bin/kafka-console-producer.sh --broker-list my-cluster-kafka-bootstrap:9092 --topic testeh
If you don't see a command prompt, try pressing enter.
>"Hello from Strimzi Mirror Maker 2"
>"Here another mirrored message"
>
```

On Kafka console consumer application, the messages will be logged like this:

```shell
"Hello from Strimzi Mirror Maker 2"
"Here another mirrored message"
```

### Conclusion

Kafka Mirror Makers 2 overcomes the limitations of Mirror Maker and it allows to setup more complicated use cases like an active-active mirroring.
Thanks to its integration in Strimzi, it's even simpler to setup this kind of scenarios with Azure Event Hub as well.
Anyway, it deserves its own blog post to show the overall architecture and the related details.

Tune on our blog in the coming weeks to read more about it!
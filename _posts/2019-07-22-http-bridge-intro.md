---
layout: post
title:  "Bridging the HTTP protocol to Apache Kafka"
date: 2019-07-22
author: paolo_patierno
---

Apache Kafka communication is based on a non-standard custom protocol on top of TCP/IP.
There are a lot of client implementations out there for different programming languages, from Java to Golang, from Python to C# and so on.
Of course, these libraries simplify developers' life because they don't have to deal with the Apache Kafka protocol on the wire; every client implementation provides a simple API for sending and receiving messages, or doing administrative operations on the topics.
By the way, there are a lot of scenarios where it's not reasonable to use these clients, so the related underneath Apache Kafka protocol.
Having the possibility to communicate through the Apache Kafka cluster using a standard protocol like HTTP/1.1 enables these scenarios.
This blog post will introduce the new HTTP - Apache Kafka bridge coming with the latest Strimzi release.

<!--more-->

Apache Kafka has its own custom binary protocol; you can find more information about it [here](https://kafka.apache.org/protocol).
While, thanks to the different client implementations for different programming languages, it's not a problem for most of the use cases, there are different scenarios where a standard protocol like HTTP/1.1 is better.

To begin, all the brokers in an Apache Kafka cluster need to be accessible from clients.
This is related to the fact that topics are partitioned and all the related partitions which are distributed on different brokers for spreading the load.
In order to read/write from/to all the partitions, the clients need to connect to more than one broker which host the "leader" partition.

Imagine a scenario where for security reasons we don't want to expose an internal, maybe company wide, Apache Kafka infrastructure to the outside but making it accessible through a "single" and more controlled entry point, reducing the attack surface.
Think about an IoT solution where due to resource constraints (CPU and memory), the embedded device cannot open a lot of TCP/IP connections; or think about a use case where an "always on" connection, as the Apache Kafka protocol needs, isn't feasible because the device sends data not so often so it's quite common just opening the connection, sending data and then closing it.

Consider mobile applications which in most of the cases use HTTP protocol for sending and receiving data through a backend system.

Finally, if you have an application written in a programming language without a related implementation for an Apache Kafka client, then in most of the cases using HTTP is much simpler.

In all the above use cases, accessing the Apache Kafka cluster through HTTP protocol enables more applications scenarios.
This is where the Strimzi HTTP - Apache Kafka bridge comes into play.

# Introduction

The HTTP - Kafka bridge allows clients to communicate each other through an Apache Kafka cluster but "talking" the HTTP/1.1 protocol.
Of course, it's also possible having HTTP clients and native Apache Kafka clients exchanging messages.

It provides a REST API described by an OpenAPI specification, exposing multiple endpoints for allowing the typical Kafka operations:

* sending messages to topics (eventually to a specific partition)
* subscribing to one or more topics (even using a pattern) as part of a consumer group, or asking for a specific partition assignment
* receving messages from the subscribed topics
* committing offsets related to the received messages
* seeking to a specific position (or at the beginning/end) in a topic partition

The client behaviour and the interaction with the Apache Kafka cluster, through the bridge, is the same as it happens with a native Kafka client but on HTTP/1.1.

Each endpoint allows some pecific HTTP methods (GET, POST, DELETE) for executing the above operations.

# Deployment on Kubernetes

The bridge deployment on Kubernetes is made really easy thanks to the new `KafkaBridge` resource provided by the Cluster Operator in Strimzi.
Following a sample snippet of a custom resource for deploying a bridge.

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaBridge
metadata:
  name: my-bridge
spec:
  replicas: 1
  bootstrapServers: my-cluster-kafka-bootstrap:9092
  consumer:
    config:
      auto.offset.reset: earliest
      enable.auto.commit: true
  producer:
    config:
      acks: 1
      delivery.timeout.ms: 300000    
  http:
    port: 8080
```

Of course, the bridge has to connect to the Apache Kafka cluster and it's allowed specifying the bootstrap servers list with the `bootstrapServers` property; at the end, the bridge uses native Apache Kafka consumer and producer for interacting with the cluster.
Talking about consumers and producers, it's possible to customize their configuration through `consumer.config` and `producer.config` specifying all the possible parameters provided by the official Apache Kafka documentation.
Finally, the `replicas` property defines the number of bridge instances to run and the `http.port` on which specific port the bridge is listening for accepting incoming HTTP connections.

As all the other components like Kafka Mirror Maker and Kafka Connect, the bridge can connect to the Apache Kafka cluster via TLS and using authentication as well.

More information about the bridge configuration are available in the official [documentation](https://strimzi.io/docs/latest/#assembly-deployment-configuration-kafka-bridge-str).

So, after having an Apache Kafka cluster running on Kubernetes and deployed by Strimzi, deploying a bridge instance is quite simple as running the following command (using the bridge example provided by the latest Strimzi release).

```shell
kubectl apply -f examples/kafka-bridge/kafka-bridge.yaml
```

Other than deploying the bridge via a Kubernetes `Deployment`, the Cluster Operator will create a `Service` in order to make accessible the bridge from HTTP clients running on other pods in the same Kubernetes cluster.
This service has a pattern name in the form "_bridge_name_-bridge-service" (i.e. per the above snippet it will be "my-bridge-bridge-service").

It's possible to create an `Ingress` for exposing the service, so the bridge, outside of the Kubernetes cluster (or a `Route` in case you are using OpenShift for example).
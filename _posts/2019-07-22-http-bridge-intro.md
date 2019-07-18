---
layout: post
title:  "Bridging the HTTP protocol to Apache Kafka"
date: 2019-07-22
author: paolo_patierno
---

Apache Kafka is based on a non-standard custom protocol on top of TCP/IP.
There are a lot of client implementations for different programming languages, from Java to Golang, from Python to C# and many more.
These libraries simplify developers' life because they don't have to deal with the Apache Kafka protocol on the wire; every client implementation provides a simple API for sending and receiving messages, or doing administrative operations on the cluster.
By the way, there are a lot of scenarios where it's not reasonable to use these clients, so the related underneath Apache Kafka protocol.
Having the possibility to communicate through an Apache Kafka cluster using a standard protocol like HTTP/1.1 enables these scenarios.
This blog post will introduce the new HTTP - Apache Kafka bridge coming with the latest Strimzi release.

<!--more-->

Apache Kafka has its own custom binary protocol and you can find more information about it, [here](https://kafka.apache.org/protocol).
Thanks to the available client implementations for different programming languages, it's not a problem for most of the use cases, but there are many more scenarios where a standard protocol like HTTP/1.1 is better.

To begin, all the brokers in an Apache Kafka cluster need to be accessible from clients.
This is related to the fact that topics are partitioned and all the related partitions are distributed on different brokers for spreading the load across the cluster.
In order to read/write from/to all the partitions, the clients need to connect to more than one broker hosting the "leader" partition.

Imagine a scenario where for security reasons we don't want to expose an internal, maybe company wide, Apache Kafka infrastructure to the outside but we prefer to make it accessible through a "single" and more controlled entry point, reducing the attack surface.

Think about an IoT solution where due to resource constraints (CPU and memory), the embedded device cannot open a lot of TCP/IP connections; or think about a use case where an "always on" connection, as the Apache Kafka protocol needs, isn't feasible because the device sends data not so often so it's quite common just opening the connection, sending data and then closing it.

Consider mobile applications which in most of the cases use HTTP protocol for sending and receiving data through a messaging system.

Finally, if you have an application written in a programming language without a related implementation for an Apache Kafka client, then in most of the cases using HTTP is much simpler.

In all the above use cases, accessing the Apache Kafka cluster through HTTP protocol enables more applications scenarios.
This is where the Strimzi HTTP - Apache Kafka bridge comes into play.
It is possible to run a single bridge instance or muliple ones, depending on the scale, and using it as an "entry" point to the Apache Kafka cluster.

# Introduction

The HTTP - Kafka bridge allows clients to communicate each other through an Apache Kafka cluster but "talking" the HTTP/1.1 protocol.
Of course, it's also possible having HTTP clients and native Apache Kafka clients exchanging messages.
It could be quite common having mobile or embedded devices sending data through HTTP to an Apache Kafka cluster running in the Cloud alongside backend applications gathering and processing this data but talking the native Apache Kafka protocol.

The bridge provides a REST API, described by an OpenAPI specification, which exposes multiple endpoints for allowing the typical Apache Kafka operations:

* sending messages to topics (eventually to a specific partition)
* subscribing to one or more topics (even using a pattern) as part of a consumer group, or asking for a specific partition assignment
* receving messages from the subscribed topics
* committing offsets related to the received messages
* seeking to a specific position (or at the beginning/end) in a topic partition

The client behaviour and the interaction with the Apache Kafka cluster, through the bridge, is the same as it happens with a native Kafka client but with HTTP/1.1 protocol semantic.

Each endpoint allows specific HTTP methods (GET, POST, DELETE) for executing the above operations.

# Producing endpoints

The bridge exposes two main REST endpoints in order to send messages:

* `/topics/{topicname}`
* `/topics/{topicname}/partitions/{partitionid}`

The first one is about sending a message to a topic `topicname` while the second one allows to specify the partition via `partitionid`.
Actually, even the first endpoint allows that but specifying the destination partition in the body.

So in order to send a message, a producer has to connect to the bridge doing an HTTP POST request to the specific endpoint with a JSON payload containing the messages collection (with value, key and partition eventually).
The following JSON payload defines three messages (aka records):

* the first one has key and value, so the bridge will send it to Kafka based on the hash of the key
* the second one has the specified destination partition (other than the mandatory value)
* the third one has just the value, so the bridge will apply round robin mechanism to determine the partition

```json
{
  "records": [
      {
          "key": "my-key",
          "value": "my-first-value"
      },
      {
          "value": "my-second-value",
          "partition": 3
      },
      {
          "value": "my-third-value"
      }
  ]
}
```

The HTTP request payload is always JSON but the message values can be JSON or binary but encoded in base64 (because anyway you are transferring binary data in a JSON payload so encoding in a string format is needed).
After sending the message to the cluster, the bridge replies to the producer with the HTTP response containing the proper response code (i.e. 200 OK if the messages were sent successfully) and a JSON payload with destination partition and offset for each message.

```json
{
  "offsets": [
      {
          "partition": 1,
          "offset": 7
      },
      {
          "partition": 3,
          "offset": 45
      },
      {
          "partition": 2,
          "offset": 24
      }
  ]
}
```

# Consuming endpoints

From a consumer perspective the bridge is much more complex due to the nature of how consuming messages from Apache Kafka works in relation to consumer groups and partitions rebalancing.
For this reason, before subscribing to topics and starting to receive messages, an HTTP client has to "create" a corresponding consumer on the bridge which also means joining a consumer group.
This happens through an HTTP POST on the following endpoint and providing some consumer configuration in the JSON payload.

`/consumers/{groupid}`

The bridge creates a new consumer joining the group `groupid` and returns to the client so called `base_uri` which is the URL that the client has to use for sending all the subsequent requests (i.e. subscribe, polling, ...).

```json
{
  "instance_id": "my-consumer",
  "base_uri":"http://my-bridge-bridge-service:8080/consumers/my-group/instances/my-consumer"
}	
```

From now on, the HTTP consumer will interact with the following endpoints for subscribing topics, getting messages, committing the offsets and finally deleting the consumer.

* `/consumers/{groupid}/instances/{name}/subscription`
* `/consumers/{groupid}/instances/{name}/records`
* `/consumers/{groupid}/instances/{name}/offsets`
* `/consumers/{groupid}/instances/{name}`

Subscribing to topics is done through an HTTP POST request bringing a topics list or a topic pattern in the JSON payload.

```json
{
  "topics": [
      "topic1",
      "topic2"
  ]
}
```

On the same endpoint it's possible to do an HTTP DELETE in order to unsubscribe to all the topics.

As a native Apache Kafka client, getting messages means doing a "poll" operation which in terms of HTTP protocol means doing more HTTP GET requests on the related endpoints; the bridge will return an array of records with topic, key, value, partition and offset.

```json
[
  {
      "topic": "topic1",
      "key": "key1",
      "value": "value1",
      "partition": 0,
      "offset": 2
  },
  {
      "topic": "topic2",
      "key": "key2",
      "value": "value2",
      "partition": 1,
      "offset": 3
  }
]
```

After consuming messages, if the auto commit feature is not enabled on consumer creation, it's possible to commit the offsets via an HTTP POST request on the related endpoint specifying an offsets collection with topic, partition and related offset to commit.

```json
{
  "offsets": [
      {
          "topic": "topic1",
          "partition": 0,
          "offset": 3
      },
      {
          "topic": "topic2",
          "partition": 1,
          "offset": 4
      }
  ]
}
```

When the HTTP client doesn't want to consume messages anymore, it can remove the corresponding consumer on the bridge doing an HTTP DELETE request.

Other than all the main operation around consuming messages, the bridge also exposes endpoints for seeking into a topic partition at the beginning, at the end or at a specific offset.

* `/consumers/{groupid}/instances/{name}/positions`
* `/consumers/{groupid}/instances/{name}/positions/beginning`
* `/consumers/{groupid}/instances/{name}/positions/end`

In order to seek to a specific position in the topci partition, the consumer can provide such an information through the JSON payload in the HTTP POST request.

# Deployment on Kubernetes

Deploying the bridge on Kubernetes is made really easy by the new `KafkaBridge` custom resource provided by the Strimzi Cluster Operator.
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

Of course, the bridge has to connect to the Apache Kafka cluster and it's done specifying the bootstrap servers list using the `bootstrapServers` property; at the end, the bridge uses native Apache Kafka consumer and producer for interacting with the cluster.
Talking about consumers and producers, it's possible to customize their configuration through `consumer.config` and `producer.config` specifying all the possible parameters provided by the official Apache Kafka documentation.
Finally, the `replicas` property defines the number of bridge instances to run and the `http.port` defines on which port the bridge is listening for accepting incoming HTTP connections.

As all the other components like Kafka Mirror Maker and Kafka Connect, the bridge can connect to the Apache Kafka cluster via TLS and using authentication as well.

More information about the bridge configuration are available in the official [documentation](https://strimzi.io/docs/latest/#assembly-deployment-configuration-kafka-bridge-str).

So, after having an Apache Kafka cluster running on Kubernetes and deployed by Strimzi, deploying a bridge instance is quite simple as running the following command (using the bridge example provided by the latest Strimzi release).

```shell
kubectl apply -f examples/kafka-bridge/kafka-bridge.yaml
```

Other than deploying the bridge via a Kubernetes `Deployment`, the Cluster Operator will create a `Service` in order to make accessible the bridge from HTTP clients running on other pods in the same Kubernetes cluster.
This service has a name in the form "_bridge_name_-bridge-service" (i.e. from the above snippet it will be "my-bridge-bridge-service").

It's possible to create an `Ingress` for exposing the service, so the bridge, outside of the Kubernetes cluster (or a `Route` in case you are using OpenShift for example).

# Conclusion

Using the HTTP protocol for exchanging messages through an Apache Kafka cluster enables a lot of scenarios where this kind of protocol is more suitable than the custom one.
The interaction with the bridge is based on the same mechanisms of a native Apache Kafka clients but using the semantics of HTTP with a REST API.
A lot of developers would be really glad to see such a feature provided by Strimzi out of the box for developing their microservices based applications with HTTP but enabling the communication through an Apache Kafka cluster.
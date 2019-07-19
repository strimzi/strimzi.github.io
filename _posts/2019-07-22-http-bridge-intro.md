---
layout: post
title:  "Bridging the HTTP protocol to Apache Kafka"
date: 2019-07-19
author: paolo_patierno
---

Apache Kafka uses a custom protocol on top of TCP/IP for communication between applications and the cluster.
There are many client implementations for different programming languages, from Java to Golang, from Python to C# and many more.
These libraries simplify development because they abstract the Apache Kafka protocol on the wire; every client implementation provides a simple API for sending and receiving messages, or performing administrative operations on the cluster.
However, there are scenarios where it is not possible to use the clients, or indeed the native protocol.
Communicating with an Apache Kafka cluster using a standard protocol like HTTP/1.1 eases development these scenarios.
This blog post will introduce the new [HTTP - Apache Kafka bridge](https://github.com/strimzi/strimzi-kafka-bridge) that's available as part of the [Strimzi 0.12 release](https://github.com/strimzi/strimzi-kafka-operator/releases/)

<!--more-->

Apache Kafka uses custom binary protocol, you can find more information about it, [here](https://kafka.apache.org/protocol).
Clients are available for many different programming languages, but there are many scenarios where a standard protocol like HTTP/1.1 is more appropriate.

For example, all the brokers in an Apache Kafka cluster need to be accessible to the clients when using the native Apache Kafka ones.
This is due to the fact that topics are partitioned and the partitions are distributed on different brokers to spread the load across the cluster.
In order to read/write from/to all the partitions, clients need to connect to more than one broker hosting the "leader" partition.

Imagine a scenario where for security reasons we don't want to expose an internal, maybe company wide, Apache Kafka infrastructure to the outside but prefer to make it accessible through a "single" and more controlled entry point, reducing the attack surface.

Consider an IoT solution where due to resource constraints (CPU and memory), the embedded device cannot open a lot of TCP/IP connections; or think about a use case where an "always on" connection, as the Apache Kafka protocol needs, isn't feasible because due to network availability. In such cases it is common for a device to open a connection, send/receive data and then close the connection.

Finally, if you have an application written in a programming language without a client implementation, then most of the time using HTTP is much simpler.

In all the above use cases, accessing the Apache Kafka cluster through the HTTP protocol enables more applications scenarios.
This is where the Strimzi HTTP - Apache Kafka bridge comes into play.
It is possible to run a single bridge instance or multiple ones, depending on the scale required, and use it as an "entry" point to the Apache Kafka cluster.

# Introduction

The HTTP - Kafka bridge allows clients to communicate with an Apache Kafka cluster over the HTTP/1.1 protocol.
It's possible to include a mixture of both HTTP clients and native Apache Kafka clients in the same cluster.
It is quite common to have mobile or embedded devices sending data through HTTP to an Apache Kafka cluster running in the Cloud alongside backend applications gathering and processing this data but talking the native Apache Kafka protocol.

The bridge provides a REST API, described by an OpenAPI specification, which exposes multiple endpoints to allow typical Apache Kafka operations:

* sending messages to topics (including to a specific partition)
* subscribing to one or more topics (even using a pattern) as part of a consumer group, or asking for a specific partition assignment
* receiving messages from the subscribed topics
* committing offsets related to the received messages
* seeking to a specific position (or at the beginning/end) in a topic partition

The client behaviour and the interaction with the Apache Kafka cluster, through the bridge, is the same which happens with a native Kafka client but with HTTP/1.1 protocol semantics.

Each endpoint allows specific HTTP methods (GET, POST, DELETE) to execute the above operations.

# Producing endpoints

The bridge exposes two main REST endpoints in order to send messages:

* `/topics/{topicname}`
* `/topics/{topicname}/partitions/{partitionid}`

The first one is used to send a message to a topic `topicname` while the second one allows the user to specify the partition via `partitionid`.
Actually, even using the first endpoint the user can specify the destination partition in the body of the message.

In order to send a message, a producer has to connect to the bridge using an HTTP POST request to the specific endpoint with a JSON payload containing the value and optionally the key and partition.

The following JSON payload defines three messages (aka records):

* the first one has key and value, so the bridge will send it to the partition based on the hash of the key
* the second one has the specified destination partition and the value
* the third one just has the value, so the bridge will apply a round robin mechanism to determine the partition

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

The HTTP request payload is always JSON but the message values can be JSON or binary (encoded in base64 because you are sending binary data in a JSON payload so encoding in a string format is needed).
After sending the message to the cluster, the bridge replies to the producer with an HTTP response containing an appropriate response code (ie. 200 OK if the messages were sent successfully) and a JSON payload with destination partition and offset for each message.

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

From a consumer perspective the bridge is much more complex due to the nature of how consuming messages from Apache Kafka works in relation to consumer groups and partition rebalancing.
For this reason, before subscribing to topics and starting to receive messages, an HTTP client has to "create" a corresponding consumer on the bridge which also means joining a consumer group.
This happens through an HTTP POST on the following endpoint and providing a consumer configuration in the JSON payload.

```
/consumers/{groupid}

{
  "name" : "my-consumer",
  "enable.auto.commit" : "false",
}
```

The bridge creates a new consumer in the group `groupid` and returns to the client so called `base_uri` which is the URL that the client has to use for sending the subsequent requests (i.e. subscribe, polling, ...).

```json
{
  "instance_id": "my-consumer",
  "base_uri":"http://my-bridge-bridge-service:8080/consumers/my-group/instances/my-consumer"
}
```

From now on, the HTTP consumer will interact with the following endpoints for subscribing to topics, getting messages, committing offsets and finally deleting the consumer.

* `/consumers/{groupid}/instances/{name}/subscription`
* `/consumers/{groupid}/instances/{name}/records`
* `/consumers/{groupid}/instances/{name}/offsets`
* `/consumers/{groupid}/instances/{name}`

Subscribing to topics is done through an HTTP POST request containing a list of topics or a topic pattern in the JSON payload.

```json
{
  "topics": [
      "topic1",
      "topic2"
  ]
}
```

As a native Apache Kafka client, getting messages means doing a "poll" operation which in terms of HTTP protocol means doing HTTP GET requests on the relevant endpoints; the bridge will return an array of records with topic, key, value, partition and offset.

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

After consuming messages, if the auto commit feature is not enabled on consumer creation, it is necessary to commit the offsets via an HTTP POST request specifying an offsets collection with topic, partition and required offset to commit.

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

The bridge also exposes endpoints for seeking into a topic partition at the beginning, at the end or at a specific offset.

* `/consumers/{groupid}/instances/{name}/positions`
* `/consumers/{groupid}/instances/{name}/positions/beginning`
* `/consumers/{groupid}/instances/{name}/positions/end`

In order to seek to a specific position in the partition, the consumer must provide offset  information through the JSON payload in the HTTP POST request.
The format is the same as used to commit the offset.


# Deployment on Kubernetes

Deploying the bridge on Kubernetes is really easy using the new `KafkaBridge` custom resource provided by the Strimzi Cluster Operator.
The following sample custom resource can be used to deploy a bridge.

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

The bridge has to connect to the Apache Kafka cluster. This is specified in the `bootstrapServers` property The bridge then uses a native Apache Kafka consumer and producer for interacting with the cluster.
It is possible to provide default values for the producer and consumer configuration when the bridge is created using the `consumer.config` and `producer.config` blocks.
The default values can be overwritten by individual producers and consumers as required.
Finally, the `replicas` property defines the number of bridge instances to run and the `http.port` defines which port the bridge will listen on for incoming HTTP connections.

As with all the other Strimzi components such as Kafka Mirror Maker and Kafka Connect, the bridge can connect to the Apache Kafka cluster via TLS and use authentication if required.

More information about the bridge configuration are available in the [documentation](https://strimzi.io/docs/latest/#assembly-deployment-configuration-kafka-bridge-str).

Once you have used Strimzi to deploy an Apache Kafka cluster on Kubernetes, deploying a bridge instance is as simple as running the following command (using the example provided by the latest Strimzi release).

```shell
kubectl apply -f examples/kafka-bridge/kafka-bridge.yaml
```

In addition to deploying the bridge via a Kubernetes `Deployment`, the Cluster Operator will create a `Service` in order to make accessible the bridge from HTTP clients running in other pods in the same Kubernetes cluster.
This service has a name in the form "_bridge_name_-bridge-service" (i.e. from the above snippet it will be "my-bridge-bridge-service").

It is possible to create an `Ingress` for exposing the service so that the bridge is accessible outside of the Kubernetes cluster (or a `Route` in case you are using OpenShift).
In one of the future blog posts, I will show how it is possible with a real example.

# Conclusion

Exposing the Apache Kafka cluster to clients using HTTP enables scenarios where use of the native clients is not desirable.
Such situations include resource constrained devices, network availability and security considerations.
Interaction with the bridge is similar to the native Apache Kafka clients but using the semantics of an HTTP REST API.
The inclusion of the HTTP Bridge in Strimzi enhances the options available to developers when building applications with Apache Kafka.

If you liked this blog post, star us on [GitHub](https://github.com/strimzi/strimzi-kafka-operator) and follow us on [Twitter](https://twitter.com/strimziio) to make sure you don't miss any of our future blog posts!

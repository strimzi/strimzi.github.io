---
layout: post
title:  "Exposing your Apache Kafka cluster through the HTTP bridge"
date: 2019-09-23
author: paolo_patierno
---

In the previous blog [post](2019-07-22-http-bridge-intro.md), we introduced the new Strimzi HTTP bridge component.
Using the bridge, it is possible to interact with the Apache Kafka cluster through the HTTP/1.1 protocol instead of the Kafka native one.
We already covered how it is really simple to deploy the bridge through the new `KafkaBridge` custom resource and via the Strimzi Cluster Operator.
We also covered all the REST endpoints that the bridge provides as an API for consumers and producers.
What we are going to describe in this blog post is how it is possible to expose the bridge outside of the Kubernetes (or OpenShift) cluster, where it is running alongside the Kafka cluster.
We will also show real examples using the `curl` command.

<!--more-->

Before starting with the bridge, the main prerequisite is having a Kubernetes cluster and an Apache Kafka cluster already deployed on top of it using the Strimzi Cluster Operator; to do so you can find information in the official documentation.

# Deploy the HTTP bridge

Deploying the bridge on Kubernetes is really easy using the new `KafkaBridge` custom resource provided by the Strimzi Cluster Operator.
For the purpose of this post, you can just use the resource provided as an example in Strimzi.

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaBridge
metadata:
  name: my-bridge
spec:
  replicas: 1
  bootstrapServers: my-cluster-kafka-bootstrap:9092
  http:
    port: 8080
```

This declaration assumes that the Kafka cluster deployed by the Strimzi Cluster Operator is named `my-cluster` otherwise you have to change the `bootstrapServers` accordingly.
All the configuration parameters for the consumer and producer part of the bridge are the default ones defined by the Apache Kafka documentation.

Just run the following command in order to apply this custom resource and allowing the Strimzi Cluster Operator to deploy the HTTP bridge for you.

```shell
kubectl apply -f examples/kafka-bridge/kafka-bridge.yaml
```

# Create a Kubernetes Ingress

An `Ingress` is a Kubernetes resource for allowing external access via HTTP/HTTPS to internal services, like the HTTP bridge.
Even if you can create an `Ingress` resource, it is possible that it could not work out of the box.
In order to have an Ingress working properly, an Ingress controller is needed to be running in the cluster.
There are many different Ingress controllers and Kubernetes already provides two of them:

* [NGINX controller](https://github.com/kubernetes/ingress-nginx)
* [GCE controller](https://github.com/kubernetes/ingress-gce) for the Google Cloud Platform

> If your cluster is running using Minikube, an NGINX ingress controller is provided as an addon that you can enable with the command `minikube addons enable ingress` before starting the cluster.

Basically, the external traffic reaches the controller which routes the traffic itself based on the rules specified by the `Ingress` resource.
What you need in this case is creating an `Ingress` resource defining the rule for routing the HTTP traffic to the Strimzi Kafka Bridge.

```yaml
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: my-bridge-ingress
spec:
  rules:
  - host: my-bridge.io
    http:
      paths:
      - path: /
        backend:
          serviceName: my-bridge-bridge-service
          servicePort: 8080
```

When the above resource is created, the Strimzi Kafka Bridge is reachable through the `my-bridge.io` host so you can interact with it using different HTTP methods at the address `http://my-bridge.io:80/<endpoint>` where `<endpoint>` is one of the REST endpoints exposed by the bridge for sending and receiving messages, subscribing to topics and so on.

> If your cluster is running using Minikube, don't forget to update your local `/etc/hosts` file adding a line as `<minikubeip> my-bridge.io` where you can get the `<minikubeip>` by running the command `minikube ip` first.

In order to verify that the Ingress is working properly, try to hit the `/healthy` endpoint of the bridge with the following `curl` command.

```shell
curl -v GET http://my-bridge.io/healthy
```

If the bridge is reachable through the Ingress, it will return an HTTP response with status code `200 OK` but an empty body.

# Producing messages

Assuming that the Kafka brokers have topic auto creation enabled, we can start immediately to send messages through the `/topic/{topicname}` endpoint exposed by the HTTP bridge.

The HTTP request payload is always JSON but the message values can be JSON or binary (encoded in base64 because you are sending binary data in a JSON payload so encoding in a string format is needed).

```shell
curl -X POST \
  http://my-bridge.io/topics/my-topic \
  -H 'content-type: application/vnd.kafka.json.v2+json' \
  -d '{
    "records": [
        {
            "key": "key-1",
            "value": "value-1"
        },
        {
            "key": "key-2",
            "value": "value-2"
        }
    ]
}'
```

After writing the messages into the topic, the bridge replies with an HTTP status code `200 OK` and a JSON paylod describing in which partition and offset the messages are written.
In this case, the auto created topic has just one partition.

```json
{ 
   "offsets":[ 
      { 
         "partition":0,
         "offset":0
      },
      { 
         "partition":0,
         "offset":1
      }
   ]
}
```

# Consuming messages

Consuming messages is not so simple as producing because there are several steps to do which involve different endpoints.
First of all, creating a consumer through the `/consumers/{groupid}` endpoint doing an HTTP POST with a body containing some of the supported configuration parameters, the name of the consumer and the data format to receive (JSON or binary).

```shell
curl -X POST http://my-bridge.io/consumers/my-group \
  -H 'content-type: application/vnd.kafka.v2+json' \
  -d '{
    "name": "my-consumer",
    "format": "json",
    "auto.offset.reset": "earliest",
    "enable.auto.commit": false
  }'
```

After creating a corresponding native Kafka consumer connected to the Kafka cluster, the bridge replies with an HTTP status code `200 OK` and a JSON payload containing the URI that the HTTP client has to use in order to interact with such a consumer for subscribing and receiving messages from topic.

```json
{ 
   "instance_id":"my-consumer",
   "base_uri":"http://my-bridge.io:80/consumers/my-group/instances/my-consumer"
}
```

# Subscribing to the topic

The most used way for a Kafka consumer to get messages from a topic is to subscribe to that topic as part of a consumer group and getting partitions assigned automatically.
Using the HTTP bridge, it's possible through an HTTP POST to the `/consumers/{groupid}/instances/{name}/subscription` endpoint providing in a JSON formatted payload the list of topics to subscribe to or a topics pattern.

```shell
curl -X POST http://my-bridge.io/consumers/my-group/instances/my-consumer/subscription \
  -H 'content-type: application/vnd.kafka.v2+json' \
  -d '{
    "topics": [
        "my-topic"
    ]
}'
```

In this case, the bridge just replies with an HTTP status code `200 OK` with an empty body.

# Consuming messages

The action of consuming messages from a Kafka topic is done with a "poll" operation when we talk about native Kafka consumer.
Tipically, A Kafka application has a "poll" loop where the poll operation is called every cycle for getting next messages.
The HTTP bridge provides the same action through the `/consumers/{groupid}/instances/{name}/records` endpoint.
Doing an HTTP GET against the above endpoint, actually does a "poll" for getting the messages from the already subscribed topics.
The first "poll" operation after the subscription doesn't always return records because it just starts the join operation of the consumer to the group and the rebalancing in order to get partitions assigned; doing a next poll actually can return messages if there are any in the topic.

```shell
curl -X GET http://my-bridge.io/consumers/my-group/instances/my-consumer/records \
  -H 'accept: application/vnd.kafka.json.v2+json'
```
When messages are available, the bridge replies with an HTTP status code `200 OK` and the JSON body containes such a messages.

```json
[ 
   { 
      "topic":"my-topic",
      "key":"key-1",
      "value":"value-1",
      "partition":0,
      "offset":0
   },
   { 
      "topic":"my-topic",
      "key":"key-2",
      "value":"value-2",
      "partition":0,
      "offset":1
   }
]
```

# Deleting a consumer

After creating and using a consumer, when it is not needed anymore, it is important to delete a consumer for freeing resources on the bridge.
It is possible through an HTTP DELETE on the `/consumers/{groupid}/instances/{name}` endpoint.

```shell
curl -X DELETE http://my-bridge.io/consumers/my-group/instances/my-consumer
```

When the consumer is deleted, the bridge replies with an HTTP status code `204 No Content`.

# Conclusion

Using a command line tool as "curl", a UI based as "Postman" or an HTTP based application developed in your preferred programming language, it is really simple to interact with an Apache Kafka cluster using the HTTP/1.1 protocol thanks to the Strimzi Kafka bridge.
This blog post has showed how it is possible with a few and simple operations for both producing and consuming messages.
Of course, the bridge provides more operations than the basic ones as for example seeking the position inside a topic partition, sending messages to a specific partition, committing offsets and more.

If you liked this blog post, star us on [GitHub](https://github.com/strimzi/strimzi-kafka-operator) and follow us on [Twitter](https://twitter.com/strimziio) to make sure you don't miss any of our future blog posts!
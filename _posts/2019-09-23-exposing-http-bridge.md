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

```
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

```
curl -v GET http://my-bridge.io/healthy
```

If the bridge is reachable through the Ingress, it will return an HTTP response with status code `200 OK` but an empty body.
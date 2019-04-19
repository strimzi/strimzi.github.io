---
layout: post
title:  "Accessing Kafka: Part 2 - Node ports"
date: 2019-04-17
author: jakub_scholz
---

In the second part of this blog post series we will look at exposing Kafka using node ports.
This post will explain how node ports work and how can they be user with Kafka.
It will also cover the different configuration options which are available to the users and cover the main pros and cons of using node ports.

<!--more-->

_This post is part of a bigger series about different ways to access a Kafka cluster powered by Strimzi.
The other parts published so far are:_

* _[Part 1 - Introduction](https://strimzi.io/2019/04/17/accessing-kafka-part-1.html)_
* _Part 2 - Node Ports (this post)_

# Node ports

`NodePort` is a special type of [Kubernetes service](https://kubernetes.io/docs/concepts/services-networking/service/#nodeport).
When such service is created, Kubernetes will allocated a port on all nodes of the Kubernetes cluster and will make sure that all traffic to this port is routed to the service and eventually to the pods behind this service.

The routing of the traffic is done by the kube-proxy Kubernetes component.
It doesn't matter on which node is your pod running.
The node ports will be open on all nodes and the traffic will always reach your pod.
So your clients need to connect to the node port on any of the nodes of the Kubernetes cluster and let Kubernetes handle the rest.

The node port is by default selected from the port range 30000-32767.
But this range can be changed in Kubernetes configuration.

So, how do we use `NodePort` type services in Strimzi to expose Apache Kafka?

# Exposing Kafka using node ports

As a user, you can easily expose Kafka using node ports.
All you need to do is to configure it in the Kafka custom resource.

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    listeners:
      # ...
      external:
        type: nodeport
    # ...
```

But what happens after you configure it is a bit more complicated.

The first think we need to address is how will the clients access the individual brokers.
As explained in the first part, having a service which will round robin across all brokers in the cluster will not work with Kafka.
The clients need to be able to reach each of the brokers directly.
Inside the Kubernetes cluster we addressed it by using the pod DNS names as the advertised addresses.
But the pod hostnames or IP addresses are not recognized outside of Kubernetes, so we cannot use them.
So, how does Strimzi solve it?

Instead, of using the pod hostnames or IP addresses, we create additional services - one of each Kafka broker.
So in a Kafka cluster with N brokers we will have N+1 node port services:

* One which can be used by the Kafka clients as the bootstrap service for the initial connection and for receiving the metadata about the Kafka cluster
* Another N services - one for each broker - to address the brokers directly

All of these services are created with the type `NodePort`.
Each of these services will be assigned different node port, so that the traffic for the different brokers can be distinguished.

![Accessing Kafka using per-pod services]({{ "/assets/2019-04-23-per-pod-services.png" }})

Since Kubernetes 1.9, every pod in a stateful set has automatically a label `statefulset.kubernetes.io/pod-name` which contains the name of the pod.
Using this label in the pod selector inside the Kubernetes service definition allows us to target only the individual Kafka brokers and not the whole Kafka cluster.

But the node port services are just the infrastructure which can route the traffic to the brokers.
We still need to configure the Kafka brokers to advertise the right address, so that the clients use this infrastructure.
With node ports, the client connecting to the broker needs to connect to the:

* address of one of the Kubernetes nodes
* node port assigned to the service

So Strimzi needs to gather these and configure these as the advertised addresses in the broker configuration.
Strimzi is using separate listeners for the external and internal access.
So any applications running inside the Kubernetes or OpenShift cluster will still use the old services and DNS names as described in part 1.

Although node port services can route the traffic to the broker from all Kubernetes nodes, we can use only single address which will be advertised to the clients.
And using the address of the actual node where the broker is running will mean less forwarding.
But every time the broker restarts, the node might change.
Therefore Strimzi is using an [init container](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) which is run every time when the Kafka broker pod is starting.
It collects the address of the node and uses it to configure the advertised address.

TODO: Picture of init container getting the address

To get the node address, the init container has to talk with the Kubernetes API and get the node resource.
In the status of the node resource, the address is normally listed as one of the following:

* External DNS
* External IP
* Internal DNS
* Internal IP
* Hostname

Sometimes, only some of these are listed in the status.
The init container will try to get one of them in the same order as they are listed above and will use the first one it finds.

Once the address is configured, the client can use the bootstrap node port service to make the initial connection.
From there the client will get the metadata containing the addresses of the individual brokers and start sending and receiving messages.

TODO: Picture of client connecting

# TLS support

Strimzi supports TLS when exposing Kafka using node ports.
For historical reasons, TLS encryption is enabled by default.
But you can disable it if you want.

```yaml
# ...
listeners:
  external:
    type: nodeport
    tls: false
# ...
```

When exposing Kafka using node ports with TLS, Strimzi currently doesn't support TLS hostname verification.
The main reason for that is that with node ports it is hard to pin down the addresses which will be used and add it to the TLS certificates.
This is mainly because:

* The node where the broker runs might change every time the pod or node is restarted
* The nodes in the cluster might sometimes change frequently and we would need to refresh the TLS certificates every time the nodes are added or removed and the addresses change.

# Dealing with problems

One of the common problems is that the address which is presented to Strimzi by the Kubernetes node is not accessible from outside.
This can happen for example because the DNS name or IP address used there is only internal.
As a result, the clients might not be able to connect



# Customizations


# Pros and cons


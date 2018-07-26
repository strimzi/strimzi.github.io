---
layout: post
title:  "Strimzi 0.5.0 released!"
date: 2018-07-25
author: paolo_patierno
---

We are really happy to announce the new Strimzi 0.5.0 release with a lot of new awesome features!

<!--more-->

# Kafka as a native Kubernetes/OpenShift resource

The first really cool feature is about the Cluster Operator moving from ConfigMaps to Custom Resources.
It means that the Kafka and the Kafka Connect clusters aren't described by ConfigMaps anymore but through Custom Resources.
Here's an example of the `Kafka` resource for deploying a Kafka cluster:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    replicas: 3
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
    storage:
      type: ephemeral
...
...
zookeeper:
    replicas: 3
...
```

Kafka is now a first citizen in the Kubernetes/OpenShift world and the cluster deployment can be managed through the `kubectl` and `oc` tools natively.
For example, you can get Kafka cluster information through the following command:

```
oc describe kafka my-cluster
```

So `kafka` is now at same level as any other Kubernetes/OpenShift native resourse, for example `configmap`, `deployment`, `secret` and so on.
The same is true for Kafka Connect cluster which is defined by a `KafkaConnect` Custom Resource.

# Encryption support

The communication across the deployed Kafka cluster is now encrypted using the TLS protocol and providing mutual authentication as well.
More precisely, the following traffic that is now encrypted:

* Zookeeper cluster communication
* Kafka cluster commbunication
* Communication between Kafka and Zookeeper
* Communication between Topic Operator and Kafka / Zookeeper

Setting up the TLS stuff is done by the Cluster Operator which generates the certificates needed for encryption.
At same time a clients CA certificate is provided within a Secret so that the user can use it for signing clients certificates and allowing client authentication for those clients which wants to connect via TLS.

# Logging configuration improvements

In order to improve the logging experience, it's now possible to specify the logging level (i.e. `DEBUG`, `INFO`, ...) in the Custom Resource describing the cluster both for Kafka and Zookeeper.
There are two different ways for doing this.

The first one is about specifying the new log level "inline" in the cluster definition.

```yaml
logging:
    type: inline
    loggers:
      logger.name: "INFO"
```

The other way is much more powerful because it's possible to provide the full log4j configuration through a `log4j.properties` file inside a ConfigMap and referring to it from the cluster description.

```yaml
logging:
    type: external
    name: customConfigMap
```

# Rack awareness

In order to have high availability, Apache Kafka provides an interesting feature called "rack awareness".
When your topics are replicated across multiple brokers, it's really useful that these brokers live in different physical racks.
If a rack fails, you are sure that other topic replicas are alive, a new leader can be elected and clients can continue to exchange messages. As opposite, if the brokers hosting replicas for a topic are put into the same rack, the partitions are not available anymore on rack failure because all brokers will go down at same time.

The new Strimzi rack awareness feature provides a way to specify a `topologyKey` in order to spread brokers across different nodes.
The `topologyKey` defines a node label which is used as `broker.rack` for configuring the Kafka brokers accordingly.

```yaml
apiVersion: {KafkaApiVersion}
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    rack:
      topologyKey: failure-domain.beta.kubernetes.io/zone
    # ...
```

When deploying the Kafka cluster in the public Cloud (i.e. Amazon, Azure and GCP), it means spreading brokers across different availability zones which can be compared to the physical racks.

# Affinity, Taints and Tolerations

Having Kafka brokers colocated on the same nodes with some other applications running on the same Kubernetes/OpenShift cluster can cause some issues like the _noisy neighbour_ phenomenon.
This is really a problem when these applications are intensively utilizing the same resource - for example network bandwidth or disk I/O.

Most Apache Kafka users want the best possible performance from their clusters.

There are several ways of getting the best out of Apache Kafka:

* Make sure Kafka pods are not scheduled on the same node as other performance intensive applications
* Make sure Kafka pods are scheduled on the nodes with the most suitable hardware
* Use nodes which are dedicated to Kafka only

Thanks to the support for affinity, taints and tolerations in the 0.5.0 release, now Strimzi supports all of the above ways.
You'll get more information about this new feature in a dedicated blog post.

# Cluster Operator handling RBAC

The Cluster Operator is now in charge to handle RBAC resource so `ServiceAccount`, `RoleBinding` and `ClusterRoleBindings` for Kafka pods and for Topic Operator pods which need permissions for accessing resources (i.e. ConfigMap, Node, ...).

# Conclusion

This release represents a really huge milestone for this open source project.
Furthermore, because Strimzi is an evolving project, there are some backwards incompatible changes as well; for having more information about them you can refer to the release [changes log](https://github.com/strimzi/strimzi/releases/tag/0.5.0).

What are you waiting for? Engage the community and help us to improve the Strimzi project for running your cluster on Kubernetes/OpenShift!
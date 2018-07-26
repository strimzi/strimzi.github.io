---
layout: post
title:  "Strimzi 0.5.0 released!"
date: 2018-07-25
author: paolo_patierno
---

We are delighted to announce the new Strimzi 0.5.0 release with many awesome new features!

<!--more-->

# Kafka as a native Kubernetes/OpenShift resource

The first really cool feature is the Cluster Operator moving from ConfigMaps to Custom Resources.
It means that the Kafka and the Kafka Connect clusters aren't described by ConfigMaps anymore but through Custom Resources.
Here's an example snippet of the `Kafka` resource for deploying a Kafka cluster:

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

Kafka is now a first-class citizen in the Kubernetes/OpenShift world and the cluster deployment can be managed through the `kubectl` and `oc` tools natively.
For example, you can get Kafka cluster information through the following command:

```
oc describe kafka my-cluster
```

So `kafka` is now at same level as any other Kubernetes/OpenShift native resourse, for example `configmap`, `deployment`, `secret` and so on.
The same is true for Kafka Connect cluster which is defined by a `KafkaConnect` or `KafkaConnectS2I` Custom Resources.

# Encryption support

The communication across the deployed Kafka cluster now uses the TLS protocol and thus benefits from both encryption and mutual authentication.
More precisely, the following traffic is now encrypted:

* Zookeeper cluster communication
* Kafka cluster commbunication
* Communication between Kafka and Zookeeper
* Communication between the Topic Operator and Kafka / Zookeeper

Setting up the TLS infrastructure is done by the Cluster Operator which generates the certificates needed for encryption.
At same time a clients CA certificate is provided within a Secret so that the user can use it for signing clients' certificates and allowing client authentication for those clients which want to connect via TLS.

# Logging configuration improvements

In order to improve the logging experience, it's now possible to specify the logging level (i.e. `DEBUG`, `INFO`, ...) in the Custom Resource describing the cluster both for Kafka and Zookeeper.
There are two different ways of doing this, as showed by the following example.

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    logging:
      type: inline
      loggers:
        kafka.root.logger: "INFO,CONSOLE"
    ...
  zookeeper:
    ...
    logging:
      type: external
      name: customConfigMap
    ...
```

The first specifies the log levels inline (that is, directly in the Kafka resource).

The other way is to provide a reference to a complete log4j configuration stored externally in a ConfigMap.

# Rack awareness

In order to have high-availability, Apache Kafka provides a feature called "rack awareness".
When your topics are replicated across multiple brokers, it is desirable for those brokers to be in different physical racks.
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

# Affinity and Tolerations

Having Kafka brokers colocated on the same nodes with some other applications running on the same Kubernetes/OpenShift cluster can cause some issues like the _noisy neighbour_ phenomenon.
This is really a problem when these applications are intensively utilizing the same resource - for example network bandwidth or disk I/O.

Most Apache Kafka users want the best possible performance from their clusters.

There are several ways of getting the best out of Apache Kafka:

* Make sure Kafka pods are not scheduled on the same node as other performance intensive applications
* Make sure Kafka pods are scheduled on the nodes with the most suitable hardware
* Use nodes which are dedicated to Kafka only

Thanks to the support for affinity and tolerations in the 0.5.0 release, now Strimzi supports all of the above ways.
You'll get more information about this new feature in a dedicated blog post.

# Cluster Operator handling RBAC

The Cluster Operator is now in charge to handle RBAC resource so `ServiceAccount`, `RoleBinding` and `ClusterRoleBindings` for Kafka pods and for Topic Operator pods which need permissions for accessing resources (i.e. ConfigMap, Node, ...).

# Renaming of services

The Kubernetes/OpenShift services for Kafka, Kafka Connect and Zookeeper have been renamed to better correspond to their purpose, in the following way :

* xxx-kafka -> xxx-kafka-bootstrap
* xxx-kafka-headless -> xxx-kafka-brokers
* xxx-zookeeper -> xxx-zookeeper-client
* xxx-zookeeper-headless -> xxx-zookeeper-nodes
* xxx-connect -> xxx-connect-api

This change is backwards incompatible so if you are using the previous names for accessing the cluster from your applications, when deploying a cluster with the new version you have to update them.

# Conclusion

This release represents a really huge milestone for this open source project.
Furthermore, because Strimzi is an evolving project, there are some backwards incompatible changes as well; for having more information about them you can refer to the release [changes log](https://github.com/strimzi/strimzi/releases/tag/0.5.0).

What are you waiting for? Engage the community and help us to improve the Strimzi project for running your cluster on Kubernetes/OpenShift!
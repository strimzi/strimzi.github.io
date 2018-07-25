---
layout: default
---

# Roadmap

## 0.6.0 (August 2018)

### Custom Resource Definitions support for Topic Operator

The Topic Operator should have support for [Custom Resource Definitions (CRDs)](https://kubernetes.io/docs/concepts/api-extension/custom-resources/).

### Add support for encryption to Kafka Connect

Add support for encryption and authentication for Kafka Connect.

### Add support for authentication and authorization

In order to use Strimzi for production workloads, it has to be possible to secure the cluster. This should 
include:

* Authentication using TLS client authentication and SASL
* Authorization

## 0.5.0 (July 2018)

### Add support for Kubernetes Affinity and Tolerations

Using Kubernetes Affinity and Tolerations, users can manage scheduling of Kafka, Zookeeper and Kafka Connect pods into nodes.

### Custom Resource Definitions support for Cluster operator

The Cluster Operator support for [Custom Resource Definitions (CRDs)](https://kubernetes.io/docs/concepts/api-extension/custom-resources/).

### Add support for TLS encryption

All traffic between Kafka brokers, Zookeeper nodes and Topic Operator is now encrypted using TLS.

## 0.4.0 (May 2018)

### Improve configuration possibilities for Kafka and Kafka Connect

Currently, Strimzi gives the user only limited possibilities to configure Kafka and Kafka Connect. Only a few 
configuration options are exposed and user configurable. Users should have more freedom to fine-tune Kafka and 
Kafka Connect configuration according to their exact needs.

### Add support for Kubernetes resource request and limits

All Strimzi deployments are currently running without any resource requests and limits (see 
[Kubernetes documentation](https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/) 
for more details). A possibility to configure resource limits and requests should be added to the Cluster Controller 
component.

## Future releases

### Kafka updates

Strimzi should make it possible to smoothly handle updates from one Kafka version to another.

### Accessing Kafka from the outside of Kubernetes/OpenShift

Currently, the Kafka deployment is accessible only from within the same Kubernetes/OpenShift cluster in which it is 
deployed. In some scenarios it will be necessary to access it from the outside.

### Support for automated cluster balancing

During the lifecycle of the Kafka cluster it can happen that it becomes unbalanced. Some nodes are hosting very _heavy_ 
topics (i.e. busy topics with a lot of traffic) while other nodes are idle most of the time hosting less busy topics.
An automated cluster balancer should continuously monitor the cluster state and balance it (re-distribute the topics) when 
needed to make sure that the load is optimally distributed across all cluster nodes.

### Service broker support

The Cluster Controller should be able to work as a [Service Broker](https://www.openservicebrokerapi.org/).

### Integration with other protocols

Allow to access Kafka using different protocols such as HTTP, AMQP or MQTT.

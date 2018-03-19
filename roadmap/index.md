---
# You don't need to edit this file, it's empty on purpose.
# Edit theme's home layout instead if you wanna make some changes
# See: https://jekyllrb.com/docs/themes/#overriding-theme-defaults
layout: default
---

# Roadmap

## Improve configuration possibilities for Kafka and Kafka Connect

Currently, Strimzi gives the user only limited possibilities to configure Kafka and Kafka Connect. Only a few 
configuration options are exposed and user configurable. Users should have more freedom to fine-tune Kafka and 
Kafka Connect configuration according to their exact needs.

## Add support for encryption, authentication and authorization

In order to use Strimzi for production workloads, it has to be possible to secure the cluster. This should 
include:

* Encryption using TLS
* Authentication using TLS client authentication and SASL
* Authorization

## Accessing Kafka from the outside of Kubernetes/OpenShift

Currently, the Kafka deployment is accessible only from within the same Kubernetes/OpenShift cluster in which it is 
deployed. In some scenarios it will be necessary to access it from the outside.

## Add support for Kubernetes resource request and limits

All Strimzi deployments are currently running without any resource requests and limits (see 
[Kubernetes documentation](https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/) 
for more details). A possibility to configure resource limits and requests should be added to the Cluster Controller 
component.

## Add support for Kubernetes node selectors

In order to achieve good performance, it might be necessary to schedule Kafka pods to specific nodes. For example, because 
they contain special storage hardware or just to run them on dedicated nodes to make sure that Kafka doesn't interfere 
with any other applications. To achieve this, it should be possible to configure node selectors for the Strimzi 
deployments.

## Custom Resource Definitions support

The Cluster and Topic Controllers should have support for [Custom Resource Definitions (CRDs)](https://kubernetes.io/docs/concepts/api-extension/custom-resources/).

## Service broker support

The Cluster Controller should be able to work as a [Service Broker](https://www.openservicebrokerapi.org/).

## Support for automated cluster balancing

During the lifecycle of the Kafka cluster it can happen that it becomes unbalanced. Some nodes are hosting very _heavy_ 
topics (i.e. busy topics with a lot of traffic) while other nodes are idle most of the time hosting less busy topics.
An automated cluster balancer should continuously monitor the cluster state and balance it (re-distribute the topics) when 
needed to make sure that the load is optimally distributed across all cluster nodes.

## Kafka updates

Strimzi should make it possible to smoothly handle updates from one Kafka version to another.

## Integration with other protocols

Allow to access Kafka using different protocols such as HTTP, AMQP or MQTT.

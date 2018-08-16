---
layout: post
title:  "Strimzi 0.6.0 released!"
date: 2018-08-XX
author: paolo_patierno
---

We are delighted to announce the new Strimzi 0.6.0 release with many awesome new features!

<!--more-->

# Topic Operator moving to Custom Resources

With the previous 0.5.0 release, the Cluster Operator already moved from ConfigMaps to Custom Resources; now it is the time for the Topic Operator doing the same!
It means that Kafka topics aren't described by ConfigMaps anymore but through Custom Resources.
Here's an example snippet of the `KafkaTopic` resource for creating a Kafka topic in a deployed cluster:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaTopic
metadata:
  name: my-topic
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 1
  replicas: 1
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
```

A Kafka topic is now a first-class citizen in the Kubernetes/OpenShift world and it can be managed through the `kubectl` and `oc` tools natively.
For example, you can get Kafka topic information through the following command:

```
oc describe kafkatopic my-topic
```

So `kafkatopic` is now at same level as any other Kubernetes/OpenShift native resourse, for example `configmap`, `deployment`, `secret` and `kafka` of course, as provided by the Cluster Operator, and so on.

# Kafka brokers listeners: let's make them configurable!

An Apache Kafka broker can have one or more listeners for accepting incoming connections from clients (consumer/producer) or other brokers as well (for replication). With this release, it is now possible to configure the `listeners` which will be enabled in the Kafka brokers.
The types of listeners currently supported are:

* PLAIN listener on port 9092 (without encryption)
* TLS listener on port 9093 (with encryption)

Here's an example snippet of a `Kafka` resource with both the listeners enabled:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    listeners:
      plain: {}
      tls: {}
    ...
```

Of course, it's possible to disable one of the listeners just not declaring it in the `Kafka` resource under the `listeners` field.
It's clear that when both the `plain` and `tls` sub-properties are not defined, the listeners will be disabled.

The listeners sub-properties might also contain additional configuration. Currently, the only supported configuration is authentication on the `tls` listener, as described in the next section.

# Authentication and Authorization support

In order to have a more secure Kafka cluster, authentication and authorization play an important role.
For example, a client can be authenticated in order to have access to the cluster for sending/receiving messages and has to be authorized in order to do so for specific topics.
In most of the real scenarios, it's better than having "anonymous" access and the freedom to use all the available topics.

The authentication is configured as part of the `listener` configuration.
For each `listener`, it is possible to specify an `authentication` property with the type of authentication and related possible parameters.
When the `authentication` property is missing, no authentication will be enabled on given listener.

Currently, the only supported authentication mechanism is the TLS client authentication as declared in the following example snippet:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    listeners:
      tls:
        authentication:
          type: tls
    ...
```

The authorization is is always configured for the whole Kafka cluster.
It means that when the authorization is enabled, through the corresponding `authorization` property, it will be applied for all enabled listeners.
When the `authorization` property is missing, no authorization will be enabled.

Currently, the only supported authorization method is the Simple authorization which uses the `SimpleAclAuthorizer` plugin that is the default authorization plugin which is part of the Apache Kafka project.

Here's an example snippet of a `Kafka` resource with authorization enabled:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    ...
    authorization:
      type: simple
    ...
```

# Managing users and their ACL rights with the new User Operator

With the addition of authentication and authorization, a simple way for declaring users was needed: here is the new User Operator!

The User Operator provides a way of managing Kafka users via OpenShift or Kubernetes resources.

It allows you to create a new user by declaring a `KafkaUser` resource.
When the user is created, the credentials will be created in a Secret.
Your application needs to use the user and its credentials for authentication and to produce or consume messages.

In addition to managing credentials for authentication, the User Operator also manages authorization rules by including a description of the user’s rights in the `KafkaUser` declaration: actually it allows to handle the Apache Kafka ACLs (Access Control Lists).

Of course, with updating and deleting a `KafkaUser` resource you are able to update and delete the related user and permissions.

Here's an example snippet of a `KafkaUser` resource for describing a user:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaUser
metadata:
  name: my-user
  labels:
    strimzi.io/cluster: my-cluster
spec:
  authentication:
    type: tls
  authorization:
    type: simple
    acls:
      - resource:
          type: topic
          name: my-topic
          patternType: literal
        operation: Read
      - resource:
          type: topic
          name: my-topic-2
          patternType: literal
        operation: Write
```

The `authentication` property allows to specify the type of authentication which will be used for the user and, currently, the only supported authentication mechanism is the TLS Client Authentication mechanism.

When the `KafkaUser` is detected by the User Operator, it will create a new secret with the same name as the `KafkaUser` resource. The secret will contain a public and private key which should be used for the TLS Client Authentication. Bundled with them will be the public key of the client certification authority which was used to sign the user certificate. All keys will be in X509 format.

Here's an example snippet of the secret containing the certificate and key:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-user
  labels:
    strimzi.io/kind: KafkaUser
    strimzi.io/cluster: my-cluster
type: Opaque
data:
  ca.crt: # Public key of the Clients CA
  user.crt: # Public key of the user
  user.key: # Private key of the user
```

The `authorization` property allows to specify the type of authorization used for that user.
Currently, the only supported authorization type is the Simple authorization which means using the `SimpleAclAuthorizer` as the default authorization plugin which is part of the Apache Kafka project.

This kind of authorization is based on describing ACL rules in the `acls` property and for each of them:

* `type`: type of ACL rule. Possible values are `allow` or `deny`.
* `operation`: specifies the operation which will be allowed or denied. Possible values are `Read`, `Write` and more.
* `resource`: specifies the resource for which does the rule apply. Possible values are `Topics`, `Consumer Groups` and 'Clusters`.

Back to the above example snippet, we are describing a user `my-user` which is authenticated using TLS client authentication and have the following permissions:

* it can `Read` from the topic `my-topic`
* it can `Write` to the topic `my-topic-2`

As you can see, thanks to the User Operator it's really simple handling Apache Kafka users and related permissions as native Kubernetes/OpenShift resources.

# Kafka Connect: new encryption and TLS client authentication support

TBD

# Helm charts for the Cluster Operator!

TBD

# Upgrade to latest Apache Kafka 2.0.0 release

TBD

# The Entity Operator

TBD

# Conclusion

This release represents another really huge milestone for this open source project.
Furthermore, because Strimzi is an evolving project, there are some deprecations as well; for more information about them you can refer to the release [changes log](https://github.com/strimzi/strimzi/releases/tag/0.5.0).

What are you waiting for? Engage with the community and help us to improve the Strimzi project for running your Kafka cluster on Kubernetes/OpenShift!
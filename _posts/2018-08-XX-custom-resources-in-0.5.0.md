---
layout: post
title:  "Strimzi adopts Custom Resources"
date: 2018-08-XX
author: tom bentley`
---

Strimzi is all about making it easy to run Kafka on a Kubernetes or OpenShift cluster.

Until Strimzi 0.5.0 we've being using `ConfigMaps` as the way for Strimzi users to express their desired cluster state.
That had a number of pros and cons, which we'll go into in a moment, but the main thing people upgrading to 0.5.0 will notice is that we are now using Custom Resources.

<!--more-->

# What is a Custom Resource anyway?

A [Custom Resource](TODO) is a way for someone to extend a Kubernetes cluster with a new resource kind.
They are often used with the [operator pattern](TODO) as a way of describing the desired resource which the operator will read and act on.
Because Strimzi uses the operator pattern to make it easy to run Kafka on Kubernetes and OpenShift it's a natural fit for the project to make use of this Kubernetes feature.

# What are the benefits of using Custom Resources?

There are several benefits. Having a more natural, expressive and hierarchical way to represent the desired cluster means that the resources Strimzi users have to write are more readable and a much better fit with native Kubernetes or OpenShift resources such as `Deployments`.

Related to that, the Kubernetes apiserver can perform validation when custom resources get created or modified. This means silly mistakes in the specification of the user's Kafka cluster are caught sooner and reported at the time the resource is created or modified. With ConfigMaps there was very limited validation and users were left to inspect the Cluster Operator logs to find out why their cluster didn't deploy as they expected.

A third benefit of using Custom Resources is that they fit better with [Role Based Access Control](TODO) (RBAC).
In Kubernetes, RBAC allows the cluster administrator to express who is allowed to access resources and in which way.
Using `ConfigMaps` to represent the desired Kafka cluster meant a difficult choice for admins:

* either let users in a particular namespace access all `ConfigMaps`, thus allowing them to create, reconfigure and delete Kafka clusters,
* or lock down access to `ConfigMaps` in that namespace in order to protect the Kafka cluster, even though other `ConfigMaps` would be completely unrelated to Strimzi.

Having our own kind allows the administrator to permission Kafka, Kafka connect and Kafka connect S2I clusters independently.

Together we felt these benefits would make Strimzi more of an enterprise-ready solution, ready for the real-life use cases we want to address.

# What are the drawbacks?

There are a few drawbacks to using Custom Resources.

Firstly, admin privileges are required to install the `CustomResourceDefinitions` which declare to the Kubernetes cluster what our custom resources look like.
This raises the bar for people wanting to try Strimzi: If they don't have admin rights on their cluster they can't try it out. 
We felt that if people are just wanting to kick the tyres they are perfectly able to do that using []`minikube`](TODO), [`minishift`](TODO) or []`oc cluster up`](TODO).
While we could have supported a dual-mode model (that is, both `ConfigMap` and custom resource approaches), we felt that the documentation and support burden of doing this would just slow down how quickly we could deliver the enterprise-class features users really want.

Second, people have to go to a bit more effort to understand how to express their desired cluster. 
We've mitigated this by generating [reference documentation](TODO) on the API provided by our custom resources. We're keen to make this documentation as useful as possible, so let us know in the comments or [on github](TODO) if there are ways it could be improved.

# Custom Resources for Kafka Connect and Kafka Connect S2I

The Strimzi Cluster Operator doesn't just support deploying Kafka clusters; it also supports Kafka Connect, and, on OpenShift, a Kafka Connect variant that uses S2I to generate your custom image.

Strimzi 0.5.0 has custom resources for these too


# Where's this headed?

In the next release of Strimzi we're planning to roll out two more custom resources:

* The `Kafkatopic` resource will provide the same benefits to people using the Topic Operator.

* The `KafkaUser` resource will make it easy for people to manage the users of their Kafka cluster in a Kuerbetes-centric way.

Put together this will mean you can deploy your Kafka application as a regular `Deployment` and provision the topic and user for that application at the same time, all expressed declaratively in YAML.

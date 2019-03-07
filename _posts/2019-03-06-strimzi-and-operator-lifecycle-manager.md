---
layout: post
title:  "Deploy Apache Kafka in few seconds with Strimzi and Operator Framework and Operator Lifecycle Manager"
date: 2019-03-06
author: jakub_scholz
---

[Operator Framework](https://github.com/operator-framework/) is an open source toolkit for writing and managing Kubernetes Operators.
It consists of several components and one of them is the [Operator Lifecycle Manager (OLM)](https://github.com/operator-framework/operator-lifecycle-manager).
OLM is an _Operator for Operators_.
It provides a declarative way for installing and managing operators.
It can make installation and management of Operators on Kubernetes much easier.
And Strimzi is part of it.

<!--more-->

The main advantage for end users of having Strimzi integrated with OLM is that they should be able to find Strimzi in different operator catalogs and install it directly from there.
Cluster administrators can also create their own catalogs with the operators they trust (and we hope Strimzi will be among them) and use OLM to let end users manage them.

So how does it look when you want to install Strimzi using OLM today?

# Kubernetes and OperatorHub.io

[OperatorHub.io](https://www.operatorhub.io/) is a registry of operators for Kubernetes.
It provides a catalog of operators together with instructions how to install them on your Kubernetes cluster.
It will guide you through the installation of the OLM itself as well as the different operators which it supports.
To see how it works, let's have a look at this video recording:

<iframe width="560" height="315" src="https://www.youtube.com/embed/BfT35ay6v-Q" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

# OpenShift 4

While on Kubernetes we had to copy and paste the commands into a terminal, the [Developer Preview of OpenShift 4](https://try.openshift.com/) is already one step further and has the Operator hub integrated directly into its web console.
Thanks to that you can install Strimzi and deploy Apache Kafka cluster just with few clicks from the UI.
To see how it works and looks on OpenShift 4, let's have a look at this video recording:

<iframe width="560" height="315" src="https://www.youtube.com/embed/KJ8S5ysY044" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

# Get up and running in few seconds

OLM makes it easy to install and manage operators.
Especially on OpenShift 4 with the web console integration you can be up and running with Apache Kafka in a few seconds.
And although you need to do things from the command line on Kubernetes, it still takes just a few seconds to copy and paste the command from the OperatorHub website and install Strimzi.
In the Strimzi project, we know that this is often a painful process for our users because it requires installation of different resources such as Custom Resource Definitions or Cluster Roles for which regular end users often don't have privileges.
OLM provides a way for cluster administrators to curate a selection of operators they trust, but delegate the task of installing and upgrading those operators to end users.
I hope that the OLM will be soon integrated in most Kubernetes clusters so that users can easily install and use trusted and proven operators in their daily work.

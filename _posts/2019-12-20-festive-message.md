---
layout: post
title:  "A look back at 2019"
date: 2019-12-20
author: strimzi_developers
---

The last year has been a busy one for Strimzi with many highlights. 
We wanted to reflect on and celebrate a few of them.

<!--more-->

Many features have been added during the year, some of the key ones:

* Storage - resizing persistent volumes and support for JBOD (including adding and removing volumes)
* Monitoring - support for [Jaeger](https://www.jaegertracing.io/) tracing, [Prometheus](https://prometheus.io/) metrics and exposing consumer lag using [Kafka Exporter](https://github.com/danielqsj/kafka_exporter)
* Support for Oauth2 authentication
* HTTP access through the Bridge
* New mechanisms for off-cluster access

In the coming year Strimzi will accelerate and we are looking forward to adding support for:

* Cluster rebalancing using [Cruise Control](https://github.com/linkedin/cruise-control)
* An Operator for handling Kafka Connect connectors as native Kubernetes resources
* Enabling ZooKeeper rolling upgrade
* Support for replication using MirrorMaker2

We are also proud of the non-technical achievements Strimzi made during the year, especially being accepted into the [Cloud Native Computing Foundation](https://www.cncf.io/). 
As part of this we also developed the first governance rules for Strimzi.  
This saw, Tom Bentley, Paolo Patierno and Jakub Scholz became the initial group of *maintainers*. 
They work tirelessly to both review code and provide guidance to new contributors. 

Strimzi was presented and demoed at a number of conferences during the year - Kubecon, Kafka Summit, Red Hat Summit and ContainerDays to name a few. 
We will be on the road again in 2020 so hope to meet more of you in person! 
We saw Strimzi reach 1000 stars on GitHub which was amazing. 
That is far more than we ever imagined when we started the project.

Finally, we would like to thank all of our contributors, users, readers, designers, and everyone else for making Strimzi such a success. 
Without you all the project would not exist, let alone have grown so much. 
We are looking forward to 2020 and wish you all the best of health and happiness in the New Year.

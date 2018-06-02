---
layout: post
title:  "Strimzi at Red Hat Summit"
date: 2018-04-21
author: paolo_patierno
---

If your plan is to attend the [Red Hat Summit 2018](https://www.redhat.com/en/summit/2018) in San Francisco (May 8-10) then you have to know that the Strimzi project will be there as well !

The offered content is really awesome because there will be one session and a dedicated lab focused on it.

<!--more-->

# Developing data streaming applications

On Tuesday, May 8th, [Marius Bogoevici](https://twitter.com/mariusbogoevici), [Gunnar Morling](https://twitter.com/gunnarmorling) and [Paolo Patierno](https://twitter.com/ppatierno) will have a lab on developing data streaming applications using Apache Kafka running on OpenShift : [Running data-streaming applications with Kafka on OpenShift](https://agenda.summit.redhat.com/SessionDetail.aspx?id=154665).

In the first module, the attendees will learn about Strimzi and how it's possible to deploy an Apache Kafka cluster just writing a ConfigMap describing the related configuration; the cluster controller will do the work for you. Then, thanks to the topic controller, developers will be able to create, update and delete topics through ConfigMap(s) as well.

In the second module, an IoT application will be described and deployed as an example of data streaming application running on Apache Kafka and using the Kafka Streams API for real-time processing.

Finally, in the third module, the [Debezium](http://debezium.io/) project will be on the stage. Using Kafka Connect, deployed by Strimzi, the demo will show a CDC (Change Data Capture) scenario getting changes from a source database and putting them to different destinations using multiple sinks.

# AMQ Streams : data streaming with Apache Kafka

On Thursday, May 10th, [David Ingham](https://twitter.com/dingha) and [Paolo Patierno](https://twitter.com/ppatierno) will have a dedicated session talking about AMQ Streams : [Introducing AMQ Streams—data streaming with Apache Kafka](https://agenda.summit.redhat.com/SessionDetail.aspx?id=154757).

They'll introduce and demonstrate AMQ Streams, an enterprise-grade distribution of Apache Kafka based on the Strimzi project. They'll showcase how AMQ Streams can be deployed on OpenShift to simplify the task of configuring, deploying, and managing Kafka clusters and Kafka-based applications at scale.

In conclusion, if you are already registered for the summit you should put the session and the lab on your agenda ... if you are not, you should register for the biggest Red Hat conference. See you in San Francisco !
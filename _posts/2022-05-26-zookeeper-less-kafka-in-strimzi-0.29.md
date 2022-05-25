---
layout: post
title:  "Video: ZooKeeper-less Kafka in Strimzi 0.29.0"
date: 2022-05-26
author: jakub_scholz
---

One of the new features introduced in Strimzi 0.29.0 is a new feature gate `UseKRaft`.
This feature gate provides a way to deploy a Kafka cluster in the KRaft (Kafka Raft metadata) mode without ZooKeeper.
This feature gate is currently experimental only and is intended to be used mainly for development and testing of Strimzi and Apache Kafka.
It is not production ready, but if you are interested, feel free to give it a try.
You can learn more about this new feature, how to use it, and what to be careful about in our new video.

<!--more-->

<iframe width="560" height="315" src="https://www.youtube.com/embed/mT7dbLNCGtQ" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

---
layout: post
title:  "Strimzi is now a CNCF Incubating project!"
date: 2024-02-08
author: paolo_patierno
---

The Strimzi community is glad to announce that the Strimzi project has been promoted to the "Incubating" level within CNCF!
This represents an important milestone for the project, signifying Strimzi’s stability and successful adoption in production environments by multiple adopters.

<!--more-->

In 2017, a group of Red Hatters started to think about the best way to run a very complex stateful workload like Apache Kafka on Kubernetes.
The very first 0.1.0 version was released in January 2018, but it was little more than a bunch of Docker images and Kubernetes YAML files.
A few months of engineering and development later, the 0.2.0 version in March 2018 was the first release resembling the operator pattern.
Finally, across different releases, the new operator introduced a cloud-native way to deploy Apache Kafka clusters on Kubernetes by using custom resources.
The Strimzi project was born!

As the project grew and had several releases, it was accepted as a sandbox project within the CNCF landscape in August 2019.
Since then, the community has been growing more as new developers started to contribute and the number of users started to increase, and many companies adopted the Strimzi operator in their production environments.

After years of growth, tons of new features, integrations, improvements, and bug fixes, Strimzi is almost ready for its 0.40.0 version, coinciding with its promotion to the CNCF "Incubating" level.

![Strimzi Incubating](/assets/images/posts/2024-02-28-strimzi-incubating.png)

Today, Strimzi is a very mature project and well-recognized as "the way” to deploy an Apache Kafka cluster on Kubernetes and deal with all the day-2 operations, from upgrades to security.
It encompasses key components of the Apache Kafka ecosystem, including Kafka Connect and Kafka Mirror Maker.
It's very well integrated with other CNCF projects like Prometheus, Open Telemetry and more.  Strimzi also provides direct support and integration with Cruise Control (by LinkedIn) for rebalancing operations.
The stats are very impressive and they really show how open source can triumph when supported by a very strong community.

* 4,200+ GitHub stars
* 5,300+ pull requests
* 2,300+ issues
* 230+ contributors
* 131 releases
* 15 public production users
* 2800+ users on the #strimzi CNCF Slack channel

We would like to thank all the contributors, users, and community members who made this possible.
Every single issue, pull request, bug raised, and discussion opened helped to improve the project.
The community was at the core.
This project is yours,this win is yours!

For more details and reading about the successful Strimzi growth, please refer to the official CNCF announcement [here](https://www.cncf.io/blog/2024/02/08/strimzi-joins-the-cncf-incubator/)
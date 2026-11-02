---
layout: post
title: "Cruise Control joins the Linux Foundation: what it means for Strimzi"
date: 2026-11-02
author: paolo_patierno
---

If you follow the Apache Kafka ecosystem, you may have already heard the news: [Cruise Control](https://github.com/cruise-control-for-kafka/cruise-control), the load-balancing engine originally developed at LinkedIn, has been donated to the [Linux Foundation](https://www.linuxfoundation.org/) and will continue its development under a new, community-driven governance model.

This is good news for Strimzi, and in this short post we want to explain why.

<!--more-->

## Cruise Control and Strimzi: a long story

Strimzi has relied on Cruise Control for cluster rebalancing since the very early days.
[Native Cruise Control support landed in Strimzi 0.18.0](https://strimzi.io/blog/2020/06/15/cruise-control/), bringing the `KafkaRebalance` custom resource and a fully operator-managed Cruise Control deployment to life.

Since then, the integration has grown steadily:

- **Cluster rebalancing**: balancing partition replicas and leaders across brokers using goals and constraints expressed in the `KafkaRebalance` resource.
- **Intra-broker (JBOD) rebalancing**: [moving data between disks on the same broker](https://strimzi.io/blog/2025/02/13/moving-data-between-jbod-disks-using-cruise-control/) when you add or remove volumes from a JBOD storage configuration.
- **Auto-rebalancing on scaling**: as of [Strimzi 0.44.0](https://strimzi.io/blog/2024/11/25/autorebalancing-on-scaling/), Strimzi can automatically trigger a Cruise Control rebalance whenever the cluster is scaled up or down, keeping things balanced without any manual intervention.

And there is more coming.
[Auto-rebalancing triggered by cluster imbalance](https://github.com/strimzi/strimzi-kafka-operator/pull/13037), leveraging Cruise Control's anomaly detection, will allow Strimzi to keep your Kafka clusters continuously balanced without requiring any human action at all.

## Why the Linux Foundation move matters

Until recently, Cruise Control development had been driven almost exclusively by a small number of contributors, with limited bandwidth and uncertain long-term direction.
Moving the project under the Linux Foundation establishes a transparent governance structure, broadens the contributor base, and gives the project a sustainable home.

The [new Technical Steering Committee (TSC)](https://github.com/cruise-control-for-kafka/cruise-control/blob/main/GOVERNANCE.md#technical-steering-committee) includes contributors from several organizations in the Kafka ecosystem, and notably some Strimzi contributors are among them: Kyle Liberti (Strimzi contributor and Cruise Control co-chair), Mickael Maison (Strimzi Metrics Reporter component owner) and Paolo Patierno (Strimzi maintainer).
This means the Strimzi community has a direct voice in the future direction of Cruise Control, and can help shape the features that matter most for Kubernetes-based Kafka deployments.

## What changes for Strimzi users

Cruise Control 3.1.0 is the [first release](https://www.linkedin.com/pulse/cruise-control-310-new-chapter-under-linux-foundation-somogyi-vass-jfo9f/) driven by the new community under the Linux Foundation, and it already delivers meaningful improvements:

* support for Apache Kafka 4.3.1
* a major Jetty upgrade
* a set of security fixes addressing known vulnerabilities in Netty, Log4j, commons-io, and Jackson

Beyond the fixes, two structural changes are worth noting.
The license has changed from BSD 2-Clause to Apache License 2.0, and the release artifacts are now published to Maven Central rather than LinkedIn's JFrog Artifactory, under the new coordinates:

```
io.cruise-control:cruise-control
io.cruise-control:cruise-control-core
io.cruise-control:cruise-control-metrics-reporter
```

Strimzi is already tracking these changes: the upcoming Strimzi 1.3.1 and 1.4.0 releases will be the first to ship with Cruise Control 3.1.0 and its new artifact coordinates.

If you are running Strimzi today, you do not need to take any action right now.
Keep an eye on the Strimzi release notes for those versions.

## Looking ahead

The donation of Cruise Control to the Linux Foundation is a positive signal for the entire Kafka-on-Kubernetes ecosystem.
A well-governed, community-driven Cruise Control means more confidence in the dependency, more contributors addressing edge cases, and a better foundation for the advanced automation features Strimzi is building on top of it.

We are looking forward to collaborating with the broader Cruise Control community and to continuing to deliver a seamless, automated cluster management experience for Strimzi users.

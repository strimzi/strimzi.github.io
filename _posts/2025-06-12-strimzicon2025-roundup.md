---
layout: post
title:  "Replaying the Stream: StrimziCon 2025 Recap and Recordings"
date: 2025-06-12
author: kate_stanley
---

![StrimziCon 2025 Banner](/assets/images/posts/2025-01-29-strimzicon2025-banner.png)

StrimziCon is over for another year!

The 2025 program included:
* 7 sessions
* 11 speakers from 5 organizations
* Over 4 hours of content

This year's content explored new Strimzi components, tips for running in production, integrations with other open source projects, and even a look into what could be coming in the future.
In the breaks between sessions attendees connected and shared their own experiences with Strimzi.

A massive thank you to everyone who joined us live on the day, and of course our wonderful speakers, the program committee who built the schedule, and of course [CNCF](https://www.cncf.io/) who hosted the event.

### Session Recordings and Slides

Similar to last year, we have uploaded all the session recordings to the [Strimzi YouTube channel](https://youtube.com/playlist?list=PLpI4X8PMthYemH5ffnnOFLRhKpJiY1oAn&feature=shared).
To help you choose which one to watch first, here's an introduction to each session, as well as links to the recording and slides.

##### Keynote ([Recording][keynote-pres]/[Slides][keynote-slides])

_Speakers: Paolo Patierno & Kate Stanley @ Red Hat_

Kate and Paolo shared some of the new features that have been added to Strimzi in the past year and what could be coming soon.
They also shared the many ways of contributing to Strimzi, and explained some of the key roles in the community.

##### Phase upgrades of Strimzi managed Kafka fleets ([Recording][upgrades-pres]/[Slides][upgrades-slides])

_Speaker: Thomas Cooper @ Red Hat_

Thomas explored how you can do phased upgrades with Kafka clusters being managed by Strimzi.
The session covered why you might want to do phased upgrades and options for your clusters in development, staging, and production environments.

##### Stretching Strimzi: Exploring Multi-Cluster Kafka for High Availability ([Recording][stretch-pres]/[Slides][stretch-slides])

_Speaker: Aswin A @ IBM_

In this session, Aswin shared the motivation and design of a new feature proposal within Strimzi: stretching a Kafka cluster across Kubernetes clusters.
The proposal is currently in discussion and we are actively looking for input from the community about this feature.

##### Strimzi & OpenTelemetry: Building End-to-End Observability for Kafka on Kubernetes ([Recording][otel-pres]/[Slides][otel-slides])

_Speaker: Neel Shah @ Middleware.io_

OpenTelemetry lets you instrument, generate, collect, and export telemetry data.
This session explains how to use OpenTelemetry to instrument your Kafka applications and capture end-to-end tracing when using Strimzi.

##### When GitOps goes wrong, and other challenges for Strimzi platform teams ([Recording][gitops-pres]/[Slides][gitops-slides])

_Speaker: Björn Löfroth @ Irori AB_

Björn has been on Strimzi platform teams since 2019 and has plenty of ghost stories to share.
This session explored failure scenarios such as Kubernetes resources going missing and certificates failing to renew.
Björn gave specific advice for each scenario, as well as more general advice to protect against other similar problems.

##### Improving Kafka monitoring with native Prometheus Metrics Reporter ([Recording][metrics-pres]/[Slides][metrics-slides])

_Speakers: Owen Corrigan, Federico Valeri, Mickael Maison @ Red Hat_

Owen, Federico and Mickael are the main contributors behind the new Strimzi Metrics Reporter.
In this session they explained why this new mechanism for collecting metrics is not only simpler, but also more performant, and showed a demo of it in action.

##### Managing a Kafka cluster in KRaft mode with Strimzi ([Recording][kraft-pres]/[Slides][kraft-slides])

_Speaker: Gantigmaa Selenge @ Red Hat_

From version 0.46.0 onwards KRaft is the only supported option for metadata management in a Strimzi cluster.
Tina explained what KRaft mode is, how to deploy a KRaft cluster with Strimzi and how to migrate your existing clusters.
The session also included some tips for running a KRaft cluster in production.

##### Become a Local Development Jedi with Strimzi and KIND ([Recording][localdev-pres]/[Slides][localdev-slides])

_Speaker: Colt McNealy @ LittleHorse_

While many developers are familiar with running Strimzi locally, it can be challenging to get locally built containers and ingress to work smoothly.
In this session Colt explored an architecture for running a Kafka and Connect cluster on KIND, with an ingress listener and a custom connector.
As well as some great tips for running locally, Colt also shared a GitHub repo with the final demo code.

### What Next?

If you've run out of StrimziCon 2025 sessions to watch, why not check out our [playlist](https://youtube.com/playlist?list=PLpI4X8PMthYemH5ffnnOFLRhKpJiY1oAn&feature=shared) of last year's event.
Find out how you can help the Strimzi community on our [Join Us](https://strimzi.io/join-us/) page on the website.

Thanks again to everyone who made this year's event such a success.

[keynote-slides]: https://drive.google.com/file/d/1LcWd9FDWJUbNcI6ORr1uCHrJpO6K6UDu/view?usp=sharing
[keynote-pres]: https://youtu.be/E70feFC42rA?si=ukH8ZLz4Iw12xFsg
[upgrades-slides]: https://tomcooper.dev/files/StrimziCon_2025_Phased_Upgrades.pdf
[upgrades-pres]: https://youtu.be/pEuYFFkQCUU?si=cjhkKEVTBrvAGhRD
[stretch-slides]: https://drive.google.com/file/d/1gkB2E-SBNCSZicwvlF93QJU6yAA6JTSn/view?usp=sharing
[stretch-pres]: https://youtu.be/_FgZx0Vc6eM?si=5WPtP6w38acahzhS
[otel-slides]: https://drive.google.com/file/d/17xBkXASHitQ17NvMWPMEHGnb9n6iZpmG/view?usp=sharing
[otel-pres]: https://youtu.be/F_d5ILEx_Hc?si=Dgk0qYO6qbfCeJMe
[gitops-slides]: https://drive.google.com/file/d/1snso1nR1hRdIHxbsiFw6qcQW0a3xxGna/view?usp=sharing
[gitops-pres]: https://youtu.be/yR2MxmMHbxY?si=SUnLMyA8DGDo44Mz
[metrics-slides]: https://docs.google.com/presentation/d/1ZBCVy6YixAc8zHQsuwD2dj044r6HzULjQZo2-RLSA_k
[metrics-pres]: https://youtu.be/evKGEziQj54?si=IQjbJ9hCsvYbpSOp
[kraft-slides]: tbd
[kraft-pres]: https://youtu.be/wJx2NYCFgHA?si=1LdmFGvFO8Np7Pbw
[localdev-slides]: https://docs.google.com/presentation/d/14Az1s9_E0NuwLperuIdoTsVXuGTP1CrcgdcqDGe6Pic/edit?usp=sharing
[localdev-pres]: https://youtu.be/1op81ib99SU?si=m_F06OLEPcaecEIM

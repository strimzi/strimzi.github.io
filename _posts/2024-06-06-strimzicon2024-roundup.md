---
layout: post
title:  "Replaying the Stream: StrimziCon 2024 Recap and Recordings"
date: 2024-06-06
author: kate_stanley
---

![StrimziCon 2024 Banner](/assets/images/posts/2024-01-29-strimzicon2024-banner.png)

StrimziCon 2024 is finished!

In the end we had:
* 8 sessions
* 11 speakers from 6 organizations
* Over 5 hours of content

The sessions covered a wide range of topics, from company use cases, to experiences migrating to Strimzi, to explorations of the Strimzi internals.
We heard from maintainers, contributors and developers who've been running Strimzi in production.
The main message that shined through on every session was how much people love working with Strimzi, not only running it, but engaging with the community as well. 

A massive thank you to all the attendees (almost 300!) who joined us live on the day, it was so great to engage with the community in real time.

We also of course need to thank everyone who helped make StrimziCon a reality - the speakers, program committee and of course CNCF who provided so much assistance in running the event.

### Session Recordings and Slides

If you weren't able to make it you'll be pleased to hear that all the session recordings are now available over on the [Strimzi YouTube channel](https://youtube.com/playlist?list=PLpI4X8PMthYemH5ffnnOFLRhKpJiY1oAn&feature=shared).
In case you aren't sure which sessions to watch, here's a rundown of the event, including links to the recording and slides for each session.

##### Keynote ([Recording][keynote-pres]/[Slides][keynote-slides])

_Speakers: Kate Stanley & Paolo Patierno @ Red Hat_

Kate and Paolo kicked off the event with a recap of Strimzi's past, a look at the latest new features, and a hint at what might be coming in the future.

##### Upgrade yourself to the Business Class ([Recording][jakub-pres]/[Slides][jakub-slides])

_Speaker: Jakub Scholz @ Red Hat_

Jakub explained why staying up to date is important for security reasons but also for example to get help.
He also showed that staying up to date is not as hard as many users think by going through the various ways of upgrading Strimzi and demoing some of them.

##### Exploring Strimzi’s implementation of rolling updates ([Recording][tina-pres]/[Slides][tina-slides])

_Speaker: Gantigmaa Selenge @ Red Hat_

In this session, Gantigmaa delved into the Strimzi component known as KafkaRoller.
She explained KafkaRoller’s decision making process and the safety assessment when performing rolling updates.

##### Transition to Apache Kafka on Kubernetes with Strimzi ([Recording][maersk-pres]/[Slides][maersk-slides])

_Speaker: Steffen Wirenfeldt Karlsson @ Maersk_

This is a classic migration case study (the past, current and the future) at scale from a world-wide company transitioning from Confluent Platform and Confluent Cloud to self-managed Apache Kafka on Kubernetes using Strimzi.
Steffen shared the story of this migration and reasoning behind it, as well as the details on how they monitor (Grafana, Prometheus), alert (GoAlert and alert as code), operate and provide self-service solutions on top of Strimzi to enable business critical application in Maersk.

##### Modernizing Nubank's Kafka Platform For The Next 10 Years Starting at 1 Trillion Messages per Month ([Recording][nubank-pres]/[Slides][nubank-slides])

_Speakers: Julio Turolla, Roni Silva @ Nubank_

In this session, Nubank engineers Julio and Roni delved into the architecture and the process of live migrating to a Strimzi setup that manages 1 trillion messages per month.
They discussed the reasons behind choosing Strimzi, the strategies employed to minimize the impact of failures through a cell-based architecture, and the detailed mechanism of topic-by-topic live migration.

##### Enhancing Kafka Topic Management in Kubernetes with the Unidirectional Topic Operator ([Recording][fede-pres]/[Slides][fede-slides])

_Speaker: Federico Valeri @ Red Hat_

This session unveils the Unidirectional Topic Operator (UTO) for Strimzi, offering Kafka administrators a seamless method to streamline topic management via Kubernetes custom resources.
Distinguishing itself from its predecessor, the Bidirectional Topic Operator (BTO), the UTO enhances scalability and extends support to Kafka clusters operating in KRaft mode.

##### Partial Multi-Tenancy on Kafka using Strimzi at LittleHorse ([Recording][littlehorse-pres]/[Slides][littlehorse-slides])

_Speaker: Colt McNealy @ LittleHorse_

The "LH Cloud Enterprise" product uses Strimzi CRD's to enable partial multi-tenancy, in which multiple applications (in their case LittleHorse clusters) share a single Kafka cluster.
In this session Colt covered how the KafkaTopic CRD simplifies the provisioning of new LH Clusters, how they use the KafkaUser CRD to enable tenant isolation, and how they use the KafkaRebalance CRD to take advantage of Cruise Control.

##### How to survive managing Strimzi in an enterprise ([Recording][axual-pres]/[Slides][axual-slides])

_Speaker: Richard Bosch, @ Axual BV_

In this session, Richard talked about experiences and insights gathered running an event streaming platform for a Tier-1 bank in The Netherlands.
Identifying the need to answer questions like who is the data owner of our topics, which team owns these applications, and how can we contact them, led the team to develop a noteworthy enterprise topic management solution.

##### Support Tiered Storage in Strimzi operated Kafka ([Recording][apple-pres]/[Slides][apple-slides])

_Speakers: Lixin Yao, Vrishali Bhor, Bo Gao @ Apple_

Lixin, Vrashali and Bo shared their experience integrating the Apache Kafka tiered storage feature with Strimzi Kafka operator and Strimzi operated Kafka clusters, and their proposal to support tiered storage feature in Strimzi natively.
They also talked about their journey of optimizing performance for their remote storage manager implementation and the valuable insights they gained along the way.

### What Next?

Hopefully we'll have another StrimziCon in future, but until then we'd love to see more people using and contributing to Strimzi.
If you're not sure where to start, here are some great ways to get involved:
- Raising any issues you find using Strimzi
- Fixing issues by opening Pull Requests
- Improving documentation
- Talking about Strimzi
- Adding your company to the list of adopters and your logo to our website

You can also check out the `good-start` and `help-wanted` labels in the GitHub repository.

Find out more about the different ways to contribute on the [Join Us](https://strimzi.io/join-us/) page.

If you want to join the conversation and connect with other Strimzi users and contributors, you can use:

* [`#strimzi` channel on CNCF Slack](https://slack.cncf.io/)
* [Strimzi Dev mailing list](https://lists.cncf.io/g/cncf-strimzi-dev/topics)
* [GitHub Discussions](https://github.com/orgs/strimzi/discussions)

[keynote-slides]: https://drive.google.com/file/d/1njiLDi4FBdHW71NDFYNjgbEXAYndRok5/view?usp=sharing
[keynote-pres]: https://youtu.be/m6gq7vXIDZE?feature=shared
[jakub-slides]: https://drive.google.com/file/d/12MQa8UcegBD-r1rt_fOKJi37Kg2aZyw4/view?usp=drive_link
[jakub-pres]: https://youtu.be/5Ji4lFbnaYs?feature=shared
[tina-slides]: https://drive.google.com/file/d/1CW6mky-7A-FR2rKl22nHS34w1GF7TiU0/view?usp=sharing
[tina-pres]: https://youtu.be/8rgCw1ayTis?feature=shared
[fede-slides]: https://docs.google.com/presentation/d/1H8lde-TZBnu3U0ON4RVMIrSDlxHkQu2A1vjyziI_DDc
[fede-pres]: https://youtu.be/2wVQ0qryC6Q?feature=shared
[nubank-slides]: https://drive.google.com/file/d/1-eLU2eRT_VeVUaZ_IgoZnItrpNNYKVYo/view?usp=drive_link
[nubank-pres]: https://youtu.be/FgS3bNsXdf4?feature=shared
[maersk-slides]: https://www.slideshare.net/slideshow/strimzicon-2024-transition-to-apache-kafka-on-kubernetes-with-strimzi-pdf/269148655
[maersk-pres]: https://youtu.be/b_Ld-mfDnjE?feature=shared
[littlehorse-slides]: https://docs.google.com/presentation/d/1YlUVz8EUfWsOuM5F4Dfo7nmUKnDp6fmYAHJDnpTXYt4/edit?usp=sharing
[littlehorse-pres]: https://youtu.be/BY-QXGR_5AE?feature=shared
[axual-slides]: https://docs.google.com/presentation/d/1l_QCzmIoyYP2fJGOGiNQRPKKiNnIpxol/edit
[axual-pres]: https://youtu.be/LUfMEfVcOtQ?feature=shared
[apple-slides]: https://drive.google.com/file/d/1iaV16cUj-QG8Znv46FD44G5vOGbE9nX_/view?usp=sharing
[apple-pres]: https://youtu.be/lOY3Tg1evOQ?feature=shared

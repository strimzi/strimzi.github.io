---
layout: post
title:  "Replaying the Stream: StrimziCon 2026 Recap and Recordings"
date: 2026-06-23
author: ppatierno
---

![StrimziCon 2026 Banner](/assets/images/posts/2026-02-18-strimzicon2026-banner.png)

StrimziCon is over for another year!

The 2026 program included:
* 6 sessions
* 10 speakers from 5 organizations
* Over 4 hours of content

This year's content included tips for running in production, best practices for using Strimzi components, and real-world use cases shared by maintainers, contributors and users of Strimzi.
In the breaks between sessions attendees connected and shared their own experiences with Strimzi.

A massive thank you to everyone who joined us live on the day, our wonderful speakers, the program committee who built the schedule, and to [CNCF](https://www.cncf.io/) for hosting the event.

### Session Recordings and Slides

All the session recordings are now available on the [Strimzi YouTube channel](https://www.youtube.com/watch?v=8U7jBzDJd8c&list=PLpI4X8PMthYcTXj9tpcLEpTgEBxQrZyBc).
To help you choose which one to watch first, here's an introduction to each session, as well as links to the recording and slides.

##### Keynote ([Recording][keynote-pres]/[Slides][keynote-slides])

_Speakers: Paolo Patierno & Kate Stanley @ IBM_

Paolo and Kate opened the event by sharing the latest features and improvements that have been added to Strimzi over the past year, including the long awaited 1.0.0 release. They also shared some insights into how the 1.0.0 release came about and provided a glimpse into what's on the horizon for the project.
Finally, they shared some updates from the community, including new ways to keep up with the wider community, the new AI policy and the path to graduation.

##### Beyond the Install: Take full ownership of your Strimzi cluster ([Recording][ownership-pres]/[Slides][ownership-slides])

_Speaker: Jakub Scholz @ Cloudera_

Jakub challenged the notion that open source is "free" and explored what it really means to own your Strimzi installation in production.
The session covered critical aspects of Strimzi ownership including securing your container supply chain, mirroring images, and handling CVEs in base images and dependencies even when there's no official patch release.

##### Who Are You? Configuring Kafka Authentication in Strimzi from TLS to Custom Principals ([Recording][auth-pres]/[Slides][auth-slides])

_Speaker: Daniel Mulder @ Axual_

Daniel walked through the full range of authentication options available in Strimzi, from basic TLS authentication to advanced custom principal builders.
The session explored listener-aware authentication patterns and how to implement a robust multi-tenancy strategy, while also discussing the risks of leaning too heavily on Strimzi internals and how to add authorization into the picture.

##### Swapping the Engine Mid-Flight: How We Moved Reddit's Petabyte Scale Kafka Fleet to Kubernetes ([Recording][mid-flight-pres]/[Slides][mid-flight-slides])

_Speaker: Sky Kistler @ Reddit_

Sky shared Reddit's remarkable journey of migrating 500+ EC2-backed Kafka brokers and petabytes of data to Strimzi on Kubernetes with zero downtime.
The session detailed their innovative "stretch cluster" approach, including DNS facade implementation, hybrid cluster setup by temporarily forking the Strimzi operator, and the step-by-step process that treated the migration as a series of safe, reversible operations rather than a risky "lift and shift."

##### Building Strimzi MCP Server for Kubernetes: Democratizing Platform Expertise Through LLMs ([Recording][mcp-pres]/[Slides][mcp-slides])

_Speaker: David Kornel, Jakub Stejskal @ IBM_

David and Jakub demonstrated how they built an open-source MCP server for Strimzi that makes platform expertise accessible through natural language interactions with LLMs.
The session included a live demo of incident diagnosis, explained the implementation using Quarkus, and discussed how structured data and prompt templates guide the LLM through expert-level troubleshooting steps while catching misconfigurations without requiring extensive documentation reading.

##### From Running to Operating: Real-World Strimzi in Production ([Recording][operating-pres]/[Slides][operating-slides])

_Speakers: Rajith Attapattu @ Randoli_

Rajith shared a real-world case study of running Strimzi at scale, covering architecture choices, monitoring insights and how they handled the upgrade to Strimzi 1.0.0.
The session explored how to instrument Strimzi with OpenTelemetry, identify signals that actually matter, and build actionable observability, along with operational patterns that help teams move from reactive firefighting to proactive reliability.

##### Disaster Recovery in action with Kafka and Strimzi ([Recording][disaster-pres]/[Slides][disaster-slides])

_Speaker: Mickael Maison, Gantigmaa Selenge @ IBM_

Mickael and Tina walked through the key considerations for setting up and operating a disaster recovery environment for Kafka using Strimzi and MirrorMaker.
The session covered monitoring replication lag and health, clean and unclean failover/failback procedures, offset translation semantics, and important limitations and pitfalls to be aware of when implementing disaster recovery.

##### Closing ([Recording][closing-pres]/[Slides][closing-slides])

_Speakers: Paolo Patierno & Kate Stanley @ IBM_

Paolo and Kate closed the event by reflecting on the day's sessions and thanking the speakers, attendees, and everyone who contributed to making StrimziCon 2026 a success.
They also posed some final questions to the audience and shared some insights from Strimzi maintainers on their favourite features and what they are looking forward to coming to the project in future.

### What Next?

If you've run out of StrimziCon 2026 sessions to watch, why not check out our [playlist](https://youtube.com/playlist?list=PLpI4X8PMthYd-rxC90Her68tgRhIFbTAQ&feature=shared) of last year's event.
Find out how you can help the Strimzi community on our [Join Us](https://strimzi.io/join-us/) page on the website.

Thanks again to everyone who made this year's event such a success.

[keynote-slides]: https://docs.google.com/presentation/d/1zOAeyVpBJdCTJOcfwch6nv4Ag-gF4UlnBUCo8It1_H8/edit?usp=sharing
[keynote-pres]: https://youtu.be/8U7jBzDJd8c?si=OaSNrwdDSc78bph2
[ownership-slides]: https://drive.google.com/file/d/1PaDxgG_RzkmeDzBb_tNyMVu4QJpJB9vF/view?usp=sharing
[ownership-pres]: https://youtu.be/0MOxDjfqQuM?si=pd7akJBHE7RIX41m
[auth-slides]: https://drive.google.com/file/d/18k5uHRrHn9PhZkkcQ1Jos7xm8PriUA7O/view?usp=sharing
[auth-pres]: https://youtu.be/zuFNBBsYyZg?si=VngmyYvpFey-a6ex
[mid-flight-slides]: https://drive.google.com/file/d/1A72401dsS7dpqx7qx9gD_nXoW-_5RWaC/view?usp=sharing
[mid-flight-pres]: https://youtu.be/6XIAgk8Hn5I?si=GxqhPjMSyc4f62_u
[mcp-slides]: https://drive.google.com/file/d/1rkPHU3zcNMpRtrj2Az1QL0FBldiKIihw/view?usp=sharing
[mcp-pres]: https://youtu.be/D-9Bd8ps7p8?si=wMpgdnjL4sK0uqKR
[operating-slides]: https://drive.google.com/file/d/15wt5t8gr4VioHU7Zu5iTlAPHDF3vNJBE/view?usp=sharing
[operating-pres]: https://youtu.be/lwL7ghlSU6s?si=T_W6B6u7StMwHWDH
[disaster-slides]: https://drive.google.com/file/d/1PpsD1HjYRUoved0TnD39utAbaiXBW3ci/view?usp=sharing
[disaster-pres]: https://youtu.be/FdGm5o_74cw?si=72mpoe_w0Vy5hs-V
[closing-slides]: https://docs.google.com/presentation/d/1zOAeyVpBJdCTJOcfwch6nv4Ag-gF4UlnBUCo8It1_H8/edit?usp=sharing
[closing-pres]: https://youtu.be/Mh-Ac4grti0?si=kA9sOZgJf_FxE9wJ

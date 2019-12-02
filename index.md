---
# You don't need to edit this file, it's empty on purpose.
# Edit theme's home layout instead if you wanna make some changes
# See: https://jekyllrb.com/docs/themes/#overriding-theme-defaults
layout: default
---

# Overview

Strimzi provides a way to run an [Apache Kafka](https://kafka.apache.org/) cluster on [Kubernetes](https://kubernetes.io/) in various deployment configurations.

See our [GitHub](http://github.com/strimzi) repository for more info.

# Quickstart

Getting up and running with an Apache Kafka cluster on Kubernetes can be very simple, when using the Strimzi project! 

Below are a few quickstart documents for different environments, that walk you through a quick and easy install for your development environment:

* [Minikube](/quickstarts/minikube/)
* [OKD](/quickstarts/okd) (the Origin Community Distribution of Kubernetes, the basis of Red Hat OpenShift)

# Downloads

Strimzi releases are available for download on our [GitHub](https://github.com/strimzi). The release artifacts
contain documentation and example YAML files for deployment on OpenShift and Kubernetes. The Docker images are
available on [Docker Hub](https://hub.docker.com/u/strimzi/).

* [Strimzi Kafka operators - latest stable version ({{site.data.releases.operator[0].version}})](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/{{site.data.releases.operator[0].version}})
* [Strimzi Kafka bridge - latest stable release ({{site.data.releases.bridge[0].version}})](https://github.com/strimzi/strimzi-kafka-bridge/releases/tag/{{site.data.releases.bridge[0].version}})

All releases can be found in the [Downloads](/downloads) page.

# Documentation

* [Strimzi Kafka operators: Quick Start Guide - latest stable version ({{site.data.releases.operator[0].version}})](/docs/quickstart/latest/)
* [Strimzi Kafka operators: Using Strimzi - latest stable version ({{site.data.releases.operator[0].version}})](/docs/latest/)
* [Strimzi Kafka bridge - latest stable version ({{site.data.releases.bridge[0].version}})](/docs/bridge/latest/)

Documentation for all releases can be found in the [Documentation](/documentation) page.

# Getting help

If you encounter any issues while using Strimzi, you can get help using:

* [#strimzi channel on CNCF Slack](https://slack.cncf.io/)
* [Strimzi Users mailing list](https://lists.cncf.io/g/cncf-strimzi-users/topics)

# Contributing

Do you want to contribute to the Strimzi project?
See our [Contributing](/contributing) page for more details.

# Roadmap

The project roadmap describing our future plans can be found in our [GitHub project](https://github.com/strimzi/strimzi-kafka-operator/projects/1).

# License

Strimzi is licensed under the [Apache License, Version 2.0](/LICENSE)

<div style="vertical-align: center; border-top: 1px solid #e8e8e8; padding-top: 1ex;">
    <h2>Strimzi is a <a href="http://cncf.io">Cloud Native Computing Foundation</a> sandbox project</h2>
    <br />
    <img src="assets/cncf-color.png">
</div>
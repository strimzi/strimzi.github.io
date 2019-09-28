---
layout: post
title:  "What's new in Strimzi 0.14.0"
date: 2019-09-30
author: jakub_scholz
---

We are delighted to announce the availability of Strimzi 0.14.0 release.
It is our first release as a CNCF Sandbox project and it is a big release with lot of new features.
This blog post will give you an overview of the new features and will be followed in next days with more detailed blog posts dedicated to each of them.

<!--more-->

## OAuth Authentication

Strimzi already supported authentication and authorization before the 0.14.0 release.
We even have a dedicated operator for managing users - which we conveniently call _User Operator_.
It supports authentication using TLS client certificates and usernames and passwords.
It also supports authorization using the SimpleACLAuthorizer which is part of Apache Kafka.
All of this is managed using the `KafkaUser` custom resources directly inside your Kubernetes cluster.
The User Operator works very well in many situations and there are many users who like like it.
But there are many situations when you do not want to manage your Kafka users separately from all other users.

One of the reasons might be that you want to have all users managed inside a single system.
That gives you much better overview of which users exist and what can they do. 
You can see it all in one place.
Most systems are also not based only around Apache Kafka.
Often single applications needs to use Kafka as well as for example some HTTP or other APIs.
And ideally it should be able to use a single identity for everything.

Kafka already supports authentication using SASL OAUTHBEARER mechanism. 
This mechanism allows clients to OAuth tokens obtained from and OAuth 2.0 authorization server and use them to authenticate against the Kafka broker.
And in the 0.14.0 release we are adding support for it also in Strimzi.
To enable the support, we developed our own [callback library](https://github.com/strimzi/strimzi-kafka-oauth) responsible for obtaining and validating the OAuth tokens.
This library is not used only by the Kafka brokers.
It is also used in all the other components which Strimzi supports and which connect to the Kafka brokers as clients such as Connect, Mirror Maker or our HTTP Bridge.
This library is also available in [Maven repositories](https://search.maven.org/artifact/io.strimzi/oauth/0.1.0/pom), so that you can use it in your own clients using the Kafka Producer, Consumer and Streams APIs.

In 0.14.0 we have just started with OAuth support.
We did extensive testing with selected OAuth 2.0 authorization servers such as [Keycloak](https://www.keycloak.org/).
But we hope that you as our community will provide us with additional feedback about this implementation - be it missing features or just letting us know how it works with your OAuth 2.0 server.
For the next releases we also plan to add support for authorization using OAuth.
Until then, you can use the User Operator to manage the ACL rights of the OAuth user.

In the coming days, we will publish a dedicated blogpost explaining how to setup and use OAuth authentication in Strimzi.

## Kafka Exporter

Kafka natively supports JMX metrics.
In Strimzi we use the [Prometheus JMX Exporter](https://github.com/prometheus/jmx_exporter) project to take the built in JMX metrics and export them as Prometheus metrics, which can be easily used in many Kubernetes environments.
However, there are some useful metrics which are missing Kafka.
For example metrics around consumer lag, offsets and more details metrics about topics and partitions.
These metrics are very important for monitoring not just your brokers but also your clients.

[Kafka Exporter](https://github.com/danielqsj/kafka_exporter) is a well know project from Daniel Qian.
It connects to Kafka as a client and collects different information about topics, partitions and consumer groups.
It then exposes these information as Prometheus metric endpoint.
You can scrape these metrics together with the other Kafka metrics into your Prometheus instance and from there you can use them in your alerts or dashboards.
To make this easier, we provide sample [Prometheus Alerts](https://github.com/strimzi/strimzi-kafka-operator/blob/master/metrics/examples/prometheus/install/prometheus-rules.yaml) and [Grafana](https://github.com/strimzi/strimzi-kafka-operator/blob/master/metrics/examples/grafana/strimzi-kafka-exporter.json) dashboard using the new metrics.

In Strimzi 0.14.0 you can now easily deploy Kafka Exporter as a part of your Kafka cluster.
All you need is to specify it in your Kafka custom resource.
In the coming days, we will publish a dedicated blogpost explaining why is Kafka Exporter important, what metrics does it provide and how to deploy it.

## Tracing

Observability is one of the big topics of the last years.
It came with the rise of micro-service based architectures and was heavily enabled by tools such as the Envoy proxy and all the different projects building on top of it.
Tracing is one of the important parts of observability.

In 0.14.0 we add support for tracing into several components supported by Strimzi.
As a basis for tracing in Strimzi, we use the two well known CNCF projects - [OpenTracing](https://opentracing.io/docs/overview/what-is-tracing/) and [Jaeger](https://www.jaegertracing.io/).
It is supported in the Kafka components based on Kafka clients - such as Mirror Maker and Connect.
The Strimzi Bridge doesn't yet support tracing in 0.14.0, but we plan to add it in one of the next versions.
The built in support for tracing makes it easy for you to enable it when deploying your applications.
You can use tracing in Kafka clients, but having a support for it in the components such as Connect or Mirror Maker will ad more trace points to your application landscape and will help you monitor the data flows and performance.

In the coming days, we will publish a dedicated blogpost focusing on tracing.

## HTTP Bridge

There are no major changes in the HTTP Bridge in 0.14.0 release.
But we continued to work on the Bridge fixed many bugs, improved the test coverage and optimized the code for better performance.
You can refer to the Strimzi Bridge release [change log](https://github.com/strimzi/strimzi-kafka-bridge/releases/tag/0.14.0) for more details.

## Environment variables

Using an operator such as Strimzi makes it sometimes hard to customize your deployment and make it run exactly as you want.
We are always trying to give our users as much flexibility as possible.
And that is why the 0.14.0 release adds a possibility to specify environment variables which will be defined inside the containers.

While most users do not care about this feature, there are some use cases where it gets handy.
For example:

* Enabling some log collection systems such as Sematext which require their own environment variables to be defined inside the containers to enable the log collection.
* Changing the timezone which is used in the container by defining the `TZ` environment variable.
Regardless whether you thing it is a good idea to have logs with timestamps from your local timezone or whether you prefer everything in UTC, you have now the choice.

## Conclusion

This release represents big milestone for Strimzi.
Not only it is our first release under CNCF but it also contains many big features.
The features singled out in this blog post represent only some of the new stuff we added in 0.14.0.
You can refer to the release [change log](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.14.0) for a full list of new features and bug fixes.
We would also like to thank to all our contributors who helped with this release and made it possible.

If you like Strimzi, star us on [GitHub](https://github.com/strimzi/strimzi-kafka-operator) and follow us on [Twitter](https://twitter.com/strimziio) to make sure you don't miss any of our future blog posts!

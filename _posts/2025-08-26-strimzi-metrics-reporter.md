---
layout: post
title: "Using Strimzi Metrics Reporter to Expose Kafka Metrics in Prometheus Format"
date: 2025-10-01
author: Owen Corrigan
---
When deploying new Kafka cluster it may be one of your intentions to monitor the cluster using metrics.
`Apache Kafka®` generates and exposes metrics that reflect how a system is operating. These metrics are 
useful for monitoring, troubleshooting, tuning, and capacity planning when it comes to running your Kafka cluster.
In essence, monitoring is crucial to ensure the health and performance of your Kafka clusters.
`Prometheus` as a metrics monitoring solution has become increasingly common due to its popularity in the cloud-native ecosystem and it is this format that we use to expose metrics.

The [Strimzi Metrics Reporter](https://github.com/strimzi/metrics-reporter) project implements the Java `MetricsReporter` interface to expose metrics via `Prometheus` and it is available from Strimzi v0.48.0.

Up to this point, we have recommended using the `JMX Exporter` as a way to expose Kafka metrics, and we have provided some example yaml files in our [Strimzi Examples folder](https://github.com/strimzi/strimzi-kafka-operator/tree/main/packaging/examples/metrics).
However, using the JMX Exporter adds unnecessary complexity. Metrics reporters first expose metrics through JMX, and then a Java agent re-exposes them over HTTP.
The `Strimzi Metrics Reporter` exposes metrics in the Prometheus format directly over HTTP, simplifying the setup and reducing resource consumption.


Here, we will discuss Strimzi Metrics Reporter installation and configuration, and 
guide you on how to use it effectively to monitor your Kafka clusters.


## Key Features
* Direct Prometheus Integration: Exposes Kafka metrics directly to Prometheus through an HTTP endpoint.
* Configurable Metrics Collection: Allows users to specify which metrics should be collected using a flexible allowlist.

### Deploying Metrics Reporter
The first step is to install the metrics reporter in your `Kafka Custom Resource`. To do this, add the following:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
  # ...
    metricsConfig:
      type: strimziMetricsReporter
  # ...  
```

By adding `type: strimziMetricsReporter` to the `metricsConfig` section of your Kafka CR, `Strimzi` will deploy a sensible set of default metric values.
However, you can add you own custom values (providing the metrics are available) by filtering the metrics by name. This is achieved by adding another field called `values` and within that field, adding `allowList`. Then you can specify which metrics you want to collect as a list. For example:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
  # ...
    metricsConfig:
      type: strimziMetricsReporter
      values:
        allowList:
          - "kafka_log.*"
          - "kafka_network.*"
  # ...  
```

If you are adding Metrics Reporter to an existing cluster (instead of starting a fresh cluster) then you will see all your
Kafka broker pods roll so that the metrics reporter config can be added to your Kafka CR.

If you would like to deploy your Kafka cluster with the Metrics Reporter enabled from the start, you can use the examples in our [Strimzi Metrics Reporter Examples folder](https://github.com/strimzi/strimzi-kafka-operator/tree/main/packaging/examples/metrics/strimzi-metrics-reporter).
by running the following command from directory:

```bash
$ kubectl apply -f kafka-metrics.yaml -n myproject
```

We have also provided some [Grafana Dashboards](https://github.com/strimzi/strimzi-kafka-operator/tree/main/packaging/examples/metrics/strimzi-metrics-reporter/grafana-dashboards) in the same directory to help you get started with visualizing your Kafka metrics in the Prometheus format.


## Conclusion
We have shown you how to deploy the `Strimzi Metrics Reporter` in your Kafka cluster and given some reasons why you might want to use it in preference to the previously recommended `JMX Exporter`.
We are looking forward to people trying it out, and we are always open to questions and suggestions, so please [reach out to us](https://strimzi.io/community/).

We have also provided you with a practical demo video in which we go through the steps outlined above. 

Thanks for reading and keep an eye on our blog posts for future updates.



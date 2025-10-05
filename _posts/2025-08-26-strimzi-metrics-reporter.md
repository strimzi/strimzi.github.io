---
layout: post
title: "Using Strimzi Metrics Reporter to expose Kafka metrics in Prometheus format"
date: 2025-10-01
author: owen_corrigan
---

## Using Strimzi Metrics Reporter in your Kafka Cluster

Apache Kafka generates and exposes metrics that reflect how it is operating.
These metrics are useful for monitoring, troubleshooting, tuning, and capacity planning when it comes to running your Kafka cluster.
In essence, monitoring is crucial to ensure the health and performance of your Kafka clusters.
Prometheus is a metrics monitoring solution that is increasingly common due to its popularity in the cloud-native ecosystem, and it is this format that we use to expose metrics.
Up to this point, we have recommended using the [JMX Exporter](https://github.com/prometheus/jmx_exporter) as a way to expose Kafka metrics, and we have provided some example YAML files in our [Strimzi Examples folder](https://github.com/strimzi/strimzi-kafka-operator/tree/main/packaging/examples/metrics).

The [Strimzi Metrics Reporter](https://github.com/strimzi/metrics-reporter) is a new project in Strimzi, still in early access, and it is available since Strimzi 0.48.0 release.
It implements the Kafka `MetricsReporter` interface to expose metrics via Prometheus.
Strimzi Metrics Reporter is designed from scratch as a Kafka plugin and allows you to configure it directly from the Kafka configuration.
That also means it is more efficient compared to other monitoring tools that run as sidecars or JVM agents.
Strimzi Metrics Reporter has fixed names for all metrics giving users much less flexibility than other tools which provide complex mapping rules based on regular expressions.
But it is easier to use and provides a metrics interface that is less fragile and fragmented, and more like an API.

Here, we will discuss Strimzi Metrics Reporter configuration, and guide you on how to use it effectively to monitor your Kafka clusters.

### Key Features
* Native Prometheus support: The reporter exposes metrics in the Prometheus format through an HTTP endpoint, without relying on JMX.
* Configurable Metrics Collection: Allows users to specify which metrics should be exposed using a flexible allowlist.

#### Deploying Metrics Reporter
The first step is to include the Strimzi Metrics Reporter in your `Kafka` custom resource.
To do this, add the following:

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

By adding `type: strimziMetricsReporter` to the `metricsConfig` section of your `Kafka` custom resource, Strimzi will export a sensible set of default metrics.
However, you can add you own custom values by filtering the metrics by name. 
This is achieved by adding another field called `values`, and within that field, adding `allowList`.
Then you can specify which metrics you want to collect, where each entry is used to filter allowed metrics.
You can put individual metrics names or use a regex to include a group of metrics and avoid having a long list.
For example:

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

If you are adding Strimzi Metrics Reporter to an existing cluster, then you will see all your Kafka broker and Controller pods roll so that the Strimzi Metrics Reporter config is set in your `Kafka` resource.
If you would like to deploy your Kafka cluster with the Strimzi Metrics Reporter enabled from the start, you can use the examples in our [Strimzi Metrics Reporter Examples folder](https://github.com/strimzi/strimzi-kafka-operator/tree/0.48.0/examples/metrics/strimzi-metrics-reporter) by running the following command:

```bash
$ kubectl apply -f https://strimzi.io/examples/0.48.0/metrics/strimzi-metrics-reporter/kafka-metrics.yaml -n myproject
```

We also provide some [Grafana Dashboards](https://github.com/strimzi/strimzi-kafka-operator/tree/0.48.0/examples/metrics/strimzi-metrics-reporter/grafana-dashboards) to help you get started with visualizing your Kafka metrics in the Prometheus format.
Strimzi Metrics Reporter can also be used with Strimzi Kafka Bridge, Kafka Connect and Kafka MirrorMaker 2, and we provide [examples](https://github.com/strimzi/strimzi-kafka-operator/tree/0.48.0/examples/metrics/strimzi-metrics-reporter) for these too.


### Conclusion
We have shown you how to deploy the Strimzi Metrics Reporter in your Kafka cluster and given some reasons why you might want to use it as an alternative to other monitoring tools.
The Strimzi Metrics Reporter was recently [featured as part of StrimziCon 2025](https://www.youtube.com/watch?v=evKGEziQj54) which you may also find worth watching.
We also provide you with a practical demo video in which we go through the steps outlined above and hopefully this will encourage you to try out Strimzi Metrics Reporter for yourself.

We are looking forward to people trying it, and as always, we are open to feedback, questions and suggestions, so please [reach out to us](https://strimzi.io/community/).
Thanks for reading and keep an eye on our blog posts for future updates.



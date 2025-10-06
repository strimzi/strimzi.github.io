---
layout: post
title: "Using Strimzi Metrics Reporter to expose Kafka metrics in Prometheus format"
date: 2025-10-06
author: owen_corrigan
---

## Using Strimzi Metrics Reporter in your Kafka Cluster

Apache Kafka generates and exposes metrics that reflect how it is operating.
These metrics are useful for monitoring, troubleshooting, tuning, and capacity planning when it comes to running your Kafka cluster.
In essence, monitoring is crucial to ensure the health and performance of your Kafka clusters.
Prometheus is a widely used monitoring solution in the cloud-native ecosystem, and Strimzi exposes metrics in this format.
The [JMX Exporter](https://github.com/prometheus/jmx_exporter) is a solid and fully supported option for existing setups and specific use cases as a way to expose Kafka metrics, and we have provided some example YAML files in our [Strimzi Examples folder](https://github.com/strimzi/strimzi-kafka-operator/tree/main/packaging/examples/metrics).

As an alternative to JMX Exporter, [Strimzi Metrics Reporter](https://github.com/strimzi/metrics-reporter) is a new project in Strimzi, still in early access, and was announced as part of [Strimzi 0.47.0](https://strimzi.io/blog/2025/07/15/what-is-new-in-strimzi-0.47.0/).
It implements the Kafka `MetricsReporter` interface to expose metrics via Prometheus.
This implementation removes the need for JMX-based exporters or additional agents.
Strimzi Metrics Reporter is designed from scratch as a Kafka plugin and allows you to configure it directly from the Kafka configuration.
This makes it more efficient than other monitoring tools that run as sidecars or JVM agents.
Strimzi Metrics Reporter uses fixed metric names, which simplifies configuration and ensures consistent naming across deployments.
Unlike tools that rely on complex mapping rules or regular expressions, it offers a straightforward way to expose metrics.
It is easier to use and provides a metrics interface that is more stable, like a well-defined API.

Here, we will discuss Strimzi Metrics Reporter configuration and guide you on how to use it effectively to monitor your Kafka clusters.

### Key Features
* Native Prometheus support: The reporter exposes metrics in the Prometheus format through an HTTP endpoint, without relying on JMX.
* Configurable Metrics Collection: Allows users to specify which metrics should be exposed using a flexible allowlist.
* Scalability and Performance: Strimzi Metrics Reporter scales efficiently with increasing numbers of metrics, maintaining low response times even as the metric count grows, demonstrating strong performance characteristics and minimal overhead, making it well-suited for large-scale Kafka deployments.

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
However, you can add your own custom values by filtering the metrics by name. 
This is achieved by adding another field called `values`, and within that field, adding `allowList`.
Then you can specify which metrics you want to collect, where each entry is used to filter allowed metrics.
You can put individual metric names or use a regex to include a group of metrics and avoid having a long list.
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

If you add Strimzi Metrics Reporter to an existing cluster, all Kafka broker and Controller pods roll to apply the new configuration without any downtime to your cluster.
If you would like to deploy your Kafka cluster with the Strimzi Metrics Reporter enabled from the start, you can use the examples in our [Strimzi Metrics Reporter Examples folder](https://github.com/strimzi/strimzi-kafka-operator/tree/0.48.0/examples/metrics/strimzi-metrics-reporter) by running the following command:

```bash
$ kubectl apply -f https://strimzi.io/examples/0.48.0/metrics/strimzi-metrics-reporter/kafka-metrics.yaml -n myproject
```

We also provide [Grafana Dashboards](https://github.com/strimzi/strimzi-kafka-operator/tree/0.48.0/examples/metrics/strimzi-metrics-reporter/grafana-dashboards) to help you visualize Kafka metrics in Prometheus format.
Strimzi Metrics Reporter can also be used with Strimzi Kafka Bridge, Kafka Connect, and Kafka MirrorMaker 2, and we provide [examples](https://github.com/strimzi/strimzi-kafka-operator/tree/0.48.0/examples/metrics/strimzi-metrics-reporter) for these too.


### Conclusion
We’ve demonstrated how to deploy the Strimzi Metrics Reporter in your Kafka cluster.
As the feature is currently in early access, we invite users to experiment with it and provide feedback based on their experience, so please [reach out to us](https://strimzi.io/community/).
The Strimzi Metrics Reporter was recently [featured as part of StrimziCon 2025](https://www.youtube.com/watch?v=evKGEziQj54) which you may also find worth watching.
We also provide you with a practical demo video on our [YouTube](https://www.youtube.com/watch?v=Za04jVp8f5c) channel in which we go through the steps outlined above, and hopefully this will encourage you to try out Strimzi Metrics Reporter for yourself.

Thanks for reading and keep an eye on our blog posts for future updates.



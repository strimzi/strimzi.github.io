---
layout: post
title:  "Monitoring of custom resources"
date: 2025-10-01
author: sebastian_gaiser_hetzner
---

Running Kafka on Kubernetes with Strimzi is straightforward.
But getting a complete, consistent view of everything in your Kubernetes and Kafka cluster(s) can still be hard.
Kafka topics and users are often owned by different teams and configured differently, especially when a Kafka cluster is shared across a company (for example, by multiple teams).
As usage grows, gathering information and troubleshooting gets harder.

This post shows a practical, low‑friction way to close monitoring gaps using [kube-state-metrics](https://github.com/kubernetes/kube-state-metrics) so you can track every Strimzi custom resource (CR) with a simple, consistent, Kubernetes‑native approach.

### What Strimzi exposes today

All Strimzi operators (Cluster, User, and Topic Operator) expose metrics in Prometheus-compatible format.
However, only the Cluster Operator exposes a metric (`strimzi_resource_state`) that reports the state of custom resources (ready or not).

It provides this metric for:

- `Kafka`
- `KafkaConnect`
- `KafkaBridge`
- `KafkaMirrorMaker2`
- `KafkaRebalance`

It does not provide this metric for:

- `KafkaNodePool`
- `KafkaConnector`
- `StrimziPodSet`

The User and Topic Operators also do not provide this metric for `KafkaUser` and `KafkaTopic`.

During routine work, it's easy to introduce misconfigurations, from a simple typo in a topic setting to using a property that was removed in the last release.
These small issues can trigger long debugging sessions. Often the fix is simple, but finding it is not.

### The simple fix: use kube-state-metrics for CRDs

Instead of relying on the limited `strimzi_resource_state` metric, you can use kube-state-metrics to cover _all_ Strimzi custom resources.

kube-state-metrics can read any Kubernetes object, including custom resources, and export Info-style metrics with labels you control. This approach gives you:

- A complete inventory of all Strimzi CRs
- Consistent metric labels across teams
- A Kubernetes‑native approach that fits existing tooling (Prometheus)

In short, you increase monitoring coverage without changing Strimzi or writing custom exporters.

### How to deploy

In general, Strimzi provides plain Kubernetes manifests in the examples directory.

#### Option A — Apply manifests

From [Strimzi 0.48.0](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.48.0) onwards, examples are included to deploy kube-state-metrics with the corresponding:

- RBAC resources (`ServiceAccount`, `RoleBinding`, `ClusterRoleBinding`)
- A `ConfigMap` for CR configuration
- The `Deployment`
- A `ServiceMonitor` for [Prometheus Operator](https://prometheus-operator.dev/) to scrape itself

[Examples directory for kube-state-metrics](https://github.com/strimzi/strimzi-kafka-operator/tree/main/examples/metrics/kube-state-metrics).

#### Option B — Use Helm

If you prefer deploying applications via Helm, you can use the [Prometheus Community Helm chart for kube-state-metrics](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-state-metrics), which deploys the required resources in one go.
This chart is also part of the commonly used [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack), so you can simply use the same values directly there.

In the following demonstration, the kube-state-metrics Helm chart version `6.3.0` (kube-state-metrics `2.17.0`) is used. See the [chart reference](https://github.com/prometheus-community/helm-charts/tree/kube-state-metrics-6.3.0/charts/kube-state-metrics).
Configuration values used:

{% raw %}
```yaml
# my-strimzi-kube-state-metrics-values.yaml
prometheus:
  monitor:
    enabled: true
collectors: []
extraArgs:
  - --custom-resource-state-only=true
rbac:
  extraRules:
    - apiGroups:
        - kafka.strimzi.io
      resources:
        - kafkatopics
        - kafkausers
        - kafkas
        - kafkanodepools
        - kafkarebalances
        - kafkaconnects
        - kafkaconnectors
        - kafkamirrormaker2s
      verbs: [ "list", "watch" ]
    - apiGroups:
        - core.strimzi.io
      resources:
        - strimzipodsets
      verbs: [ "list", "watch" ]
    - apiGroups:
        - access.strimzi.io
      resources:
        - kafkaaccesses
      verbs: [ "list", "watch" ]
customResourceState:
  enabled: true
  config:
    spec:
      resources:
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: KafkaTopic
          metricNamePrefix: strimzi_kafka_topic
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka topic resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                ready: [ status, conditions, "[type=Ready]", status ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                partitions: [ spec, partitions ]
                replicas: [ spec, replicas ]
                generation: [ status, observedGeneration ]
                topicId: [ status, topicId ]
                topicName: [ status, topicName ]
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: KafkaUser
          metricNamePrefix: strimzi_kafka_user
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka user resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                ready: [ status, conditions, "[type=Ready]", status ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                secret: [ status, secret ]
                generation: [ status, observedGeneration ]
                username: [ status, username ]
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: Kafka
          metricNamePrefix: strimzi_kafka
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                ready: [ status, conditions, "[type=Ready]", status ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                kafka_version: [ status, kafkaVersion ]
                kafka_metadata_state: [ status, kafkaMetadataState ]
                kafka_metadata_version: [ status, kafkaMetadataVersion ]
                cluster_id: [ status, clusterId ]
                operator_last_successful_version: [ status, operatorLastSuccessfulVersion ]
                generation: [ status, observedGeneration ]
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: KafkaNodePool
          metricNamePrefix: strimzi_kafka_node_pool
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka node pool resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                # KafkaNodePool is not having a ready status as this is implemented via Kafka resource
                # ready: [ status, conditions, "[type=Ready]", status ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                node_ids: [ status, nodeIds ]
                roles: [ status, roles ]
                replicas: [ status, replicas ]
                cluster_id: [ status, clusterId ]
                generation: [ status, observedGeneration ]
        - groupVersionKind:
            group: core.strimzi.io
            version: v1beta2
            kind: StrimziPodSet
          metricNamePrefix: strimzi_pod_set
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi pod set resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                currentPods: [ status, currentPods ]
                pods: [ status, pods ]
                readyPods: [ status, readyPods ]
                generation: [ status, observedGeneration ]
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: KafkaRebalance
          metricNamePrefix: strimzi_kafka_rebalance
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi kafka rebalance resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                ready: [ status, conditions, "[type=Ready]", status ]
                proposal_ready: [ status, conditions, "[type=ProposalReady]", status ]
                rebalancing: [ status, conditions, "[type=Rebalancing]", status ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                template: [ metadata, annotations, "strimzi.io/rebalance-template" ]
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: KafkaConnect
          metricNamePrefix: strimzi_kafka_connect
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka Connect resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                ready: [ status, conditions, "[type=Ready]", status ]
                generation: [ status, observedGeneration ]
                connectorPluginsClass: [ status, connectorPlugins, class ]
                connectorPluginsType: [ status, connectorPlugins, type ]
                connectorPluginsVersion: [ status, connectorPlugins, version ]
                replicas: [ status, replicas ]
                labelSelector: [ status, labelSelector ]
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: KafkaConnector
          metricNamePrefix: strimzi_kafka_connector
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka Connector resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                ready: [ status, conditions, "[type=Ready]", status ]
                generation: [ status, observedGeneration ]
                autoRestartCount: [ status, autoRestart, count ]
                autoRestartConnectorName: [ status, autoRestart, connectorName ]
                tasksMax: [ status, tasksMax ]
                topics: [ status, topics ]
        - groupVersionKind:
            group: kafka.strimzi.io
            version: v1beta2
            kind: KafkaMirrorMaker2
          metricNamePrefix: strimzi_kafka_mm2
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka MirrorMaker2 resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                ready: [ status, conditions, "[type=Ready]", status ]
                generation: [ status, observedGeneration ]
                autoRestartCount: [ status, autoRestartStatuses, count ]
                autoRestartConnectorName: [ status, autoRestartStatuses, connectorName ]
                connectorPluginsClass: [ status, connectorPlugins, class ]
                connectorPluginsType: [ status, connectorPlugins, type ]
                connectorPluginsVersion: [ status, connectorPlugins, version ]
                labelSelector: [ status, labelSelector ]
                replicas: [ status, replicas ]
        - groupVersionKind:
            group: access.strimzi.io
            version: v1alpha1
            kind: KafkaAccess
          metricNamePrefix: strimzi_kafka_access
          metrics:
            - name: resource_info
              help: "The current state of a Strimzi Kafka Access resource."
              each:
                type: Info
                info:
                  labelsFromPath:
                    name: [ metadata, name ]
              labelsFromPath:
                exported_namespace: [ metadata, namespace ]
                ready: [ status, conditions, "[type=Ready]", status ]
                deprecated: [ status, conditions, "[reason=DeprecatedFields]", type ]
                generation: [ status, observedGeneration ]
# Warning: Helm interpretes `{{}}`, so this needs to be escaped
extraManifests:
  - apiVersion: monitoring.coreos.com/v1
    kind: PrometheusRule
    metadata:
      name: strimzi-kube-state-metrics
    spec:
      groups:
        - name: strimzi-kube-state-metrics
          rules:
            - alert: KafkaTopicNotReady
              expr: strimzi_kafka_topic_resource_info{ready!="True"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaTopic {{`{{ $labels.topicName }}`}} is not ready"
            - alert: KafkaTopicDeprecated
              expr: strimzi_kafka_topic_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaTopic {{`{{ $labels.topicName }}`}} contains a deprecated configuration"
            - alert: KafkaUserNotReady
              expr: strimzi_kafka_user_resource_info{ready!="True"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaUser {{`{{ $labels.username }}`}} is not ready"
            - alert: KafkaUserDeprecated
              expr: strimzi_kafka_user_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaUser {{`{{ $labels.username }}`}} contains a deprecated configuration"
            - alert: KafkaNotReady
              expr: strimzi_kafka_resource_info{ready!="True"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi Kafka {{`{{ $labels.name }}`}} using {{`{{ $labels.kafka_version }}`}} is not ready"
            - alert: KafkaDeprecated
              expr: strimzi_kafka_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi Kafka {{`{{ $labels.name }}`}} contains a deprecated configuration"
            # KafkaNodePool is not having a ready status as this is implemented via Kafka resource
            - alert: KafkaNodePoolDeprecated
              expr: strimzi_kafka_node_pool_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaNodePool {{`{{ $labels.name }}`}} contains a deprecated configuration"
            # StrimziPodSet is not having any further information as it is an internal resource and doesn't get operated by the user
            - alert: KafkaRebalanceNotReady
              expr: strimzi_kafka_rebalance_resource_info{ready!="True",template!="true"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaRebalance {{`{{ $labels.name }}`}} is not ready"
            - alert: KafkaRebalanceProposalPending
              expr: strimzi_kafka_rebalance_resource_info{ready="True",template!="true",proposal_ready="True"}
              for: 1h
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaRebalance {{`{{ $labels.name }}`}} is in proposal pending state and waits for approval for more than 1h."
            - alert: KafkaRebalanceRebalancing
              expr: strimzi_kafka_rebalance_resource_info{ready="True",template!="true",rebalancing="True"}
              for: 1h
              labels:
                severity: info
              annotations:
                message: "Strimzi KafkaRebalance {{`{{ $labels.name }}`}} is taking longer than 1h."
            - alert: KafkaRebalanceDeprecated
              expr: strimzi_kafka_rebalance_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaRebalance {{`{{ $labels.name }}`}} contains a deprecated configuration"
            - alert: KafkaConnectNotReady
              expr: strimzi_kafka_connect_resource_info{ready!="True"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaConnect {{`{{ $labels.name }}`}} is not ready"
            - alert: KafkaConnectDeprecated
              expr: strimzi_kafka_connect_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaConnect {{`{{ $labels.name }}`}} contains a deprecated configuration"
            - alert: KafkaConnectorNotReady
              expr: strimzi_kafka_connector_resource_info{ready!="True"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaConnector {{`{{ $labels.name }}`}} is not ready"
            - alert: KafkaConnectorDeprecated
              expr: strimzi_kafka_connector_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaConnector {{`{{ $labels.name }}`}} contains a deprecated configuration"
            - alert: KafkaMirrorMaker2NotReady
              expr: strimzi_kafka_mm2_resource_info{ready!="True"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaMirrorMaker2 {{`{{ $labels.name }}`}} is not ready"
            - alert: KafkaMirrorMaker2Deprecated
              expr: strimzi_kafka_mm2_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaMirrorMaker2 {{`{{ $labels.name }}`}} contains a deprecated configuration"
            - alert: KafkaAccessNotReady
              expr: strimzi_kafka_access_resource_info{ready!="True"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaAccess {{`{{ $labels.name }}`}} is not ready"
            - alert: KafkaAccessDeprecated
              expr: strimzi_kafka_access_resource_info{deprecated="Warning"}
              for: 15m
              labels:
                severity: warning
              annotations:
                message: "Strimzi KafkaAccess {{`{{ $labels.name }}`}} contains a deprecated configuration"
```
{% endraw %}

Then you can simply install kube-state-metrics by executing:

```bash
helm install strimzi-kube-state-metrics oci://ghcr.io/prometheus-community/charts/kube-state-metrics --version 6.3.0 -f my-strimzi-kube-state-metrics-values.yaml
```

### Verify it works

Once Prometheus is scraping kube-state-metrics, try these queries to confirm it’s working.

Get an overview about your `Kafka` clusters:

```
sum by (namespace, name, cluster_id, ready) (strimzi_kafka_resource_info)
```

Example output:

```
{cluster_id="123456789", name="my-first-kafka",  namespace="kafka-one",   ready="True"}
{cluster_id="abcdefghj", name="my-second-kafka", namespace="kafka-two",   ready="True"}
{cluster_id="zyxwvutsr", name="my-third-kafka",  namespace="kafka-three", ready="False"}
```

Get an overview of `KafkaTopic`(s) with partitions and replicas:

```
sum by (name, partitions, replicas) (strimzi_kafka_topic_resource_info)
```

Example output:

```
{name="my-first-kafka-topic",  partitions="1",  replicas="1"}
{name="my-second-kafka-topic", partitions="12", replicas="3"}
{name="my-third-kafka-topic",  partitions="60", replicas="3"}
```

Get an overview of `KafkaUser`(s) with username:

```
sum by (name, namespace, username) (strimzi_kafka_user_resource_info)
```

Example output:

```
{name="my-first-kafkauser",  username="CN=my-first-kafkauser"}
{name="my-second-kafkauser", username="CN=my-second-kafkauser"}
{name="my-third-kafkauser",  username="CN=my-third-kafkauser"}
```

### Deprecation

With the new kube-state-metrics–based metrics, the built‑in Cluster Operator metrics are deprecated as of [Strimzi 0.48.0](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.48.0) and will be removed in Strimzi 0.51.0.
If you still rely on strimzi_resource_state, plan migration now.
Progress on the removal is tracked here: [https://github.com/strimzi/strimzi-kafka-operator/issues/11696](https://github.com/strimzi/strimzi-kafka-operator/issues/11696).

### Wrap‑up

By using kube-state-metrics, you can monitor all Strimzi custom resources.
This makes it easier to spot misconfigurations and stay informed about deprecations.
These metrics can also power custom Grafana dashboards for a high‑level overview of deployed infrastructure without needing direct Kubernetes access.

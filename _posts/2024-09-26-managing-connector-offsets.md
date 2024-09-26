---
layout: post
title:  "Managing Connector Offsets"
date: 2024-08-26
author: kate_stanley
---

When building data pipelines using Kafka Connect, or replicating data using MirrorMaker, offsets are used to keep track of the flow of data.
Sink connectors use the usual Kafka consumer offset mechanism, while source connectors can store offsets with a custom format in a Kafka topic.

To manage connector offsets, rather than directly interacting with the underlying Kafka topics, you can make use of the following endpoints from the Connect REST API:

* `GET /connectors/{connector}/offsets` to list offsets
* `PATCH /connectors/{connector}/offsets` to alter offsets
* `DELETE /connectors/{connector}/offsets` to reset offsets

In the next release of Strimzi you will also be able to manage connector offsets directly in the KafkaConnector and KafkaMirrorMaker2 custom resources.
This blog post steps through how you can use this new functionality.
The process is very similar for both Kafka Connect and MirrorMaker, so we'll demonstrate how to do it with KafkaConnect and then explain how the process applies to MirrorMaker.

### Before we begin

If you want to follow along the steps in this blog post you need a Kubernetes cluster containing the Strimzi operator, a Kafka cluster, a Connect cluster, and a running connector.
First run through the Strimzi [quickstart guide](https://strimzi.io/quickstarts/) to deploy your Strimzi operator and Kafka cluster.

Once you have a Kafka cluster you can deploy Connect and a connector using the following commands:
1. `kubectl apply -f https://strimzi.io/examples/latest/connect/kafka-connect-build.yaml -n kafka`
2. `kubectl wait kafkaconnect/my-connect-cluster --for=condition=Ready --timeout=300s -n kafka`
3. `kubectl annotate kafkaconnect my-connect-cluster strimzi.io/use-connector-resources=true -n kafka`
4. `kubectl apply -f https://strimzi.io/examples/latest/connect/source-connector.yaml -n kafka`
5. `kubectl wait kafkaconnector/my-source-connector --for=condition=Ready --timeout=300s -n kafka`

### Listing offsets

To list offsets edit your `KafkaConnector` resource using `kubectl edit kafkaconnector my-source-connector -n kafka` to add configuration for where to output the offsets:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
# ...
spec:
  #...
  listOffsets:
    toConfigMap:
      name: my-connector-offsets
  #...
```

This tells Strimzi to write the offsets to a ConfigMap called `my-connector-offsets`.

To trigger the Strimzi to get the latest offsets you need to annotate your `KafkaConnector` resource:

```shell
$ kubectl annotate kafkaconnector my-source-connector strimzi.io/connector-offsets=list -n kafka
```

After a couple of minutes you should have a new ConfigMap containing the output:

```shell
$ kubectl get configmap my-connector-offsets -n kafka -oyaml
apiVersion: v1
kind: ConfigMap
metadata:
  creationTimestamp: "2024-09-26T10:20:15Z"   (1)
  labels:
    strimzi.io/cluster: my-connect-cluster
  name: my-connector-offsets
  namespace: kafka
  ownerReferences:    (2)
  - apiVersion: kafka.strimzi.io/v1beta2
    blockOwnerDeletion: false
    controller: false
    kind: KafkaConnector
    name: my-source-connector
    uid: 637e3be7-bd96-43ab-abde-c55b4c4550e0
  resourceVersion: "66951"
  uid: 641d60a9-36eb-4f29-9895-8f2c1eb9638e
data:   (3)
  offsets.json: |-
    {
      "offsets" : [ {
        "partition" : {
          "filename" : "/opt/kafka/LICENSE"
        },
        "offset" : {
          "position" : 15295
        }
      } ]
    }
```

1. If the ConfigMap doesn't already exist Strimzi will create it.
2. The owner reference points to your KafkaConnector resource. To provide a custom owner reference, create the ConfigMap in advance and set an owner reference.
3. Strimzi puts the offsets into a field called `offsets.json`. It doesn't overwrite any other fields when updating an existing ConfigMap.

You can check that the output matches the results from the Connect REST API by calling the `GET /connectors/{connector}/offsets` endpoint directly:

```shell
$ kubectl exec -n kafka -it my-connect-cluster-connect-0 -- curl localhost:8083/connectors/my-source-connector/offsets
{"offsets":[{"partition":{"filename":"/opt/kafka/LICENSE"},"offset":{"position":15295}}]}
```

### Altering offsets

To alter offsets for a connector you also need a ConfigMap, this time to tell Strimzi the new offsets to set.
All sink connectors use the same format, however for source connectors it varies.
The easiest way to create the ConfigMap for altering offsets, is actually to reuse the ConfigMap that Strimzi wrote the offsets into.

To alter connector offsets the connector also needs to be stopped.

Edit the `KafkaConnector` resource to set the `my-connector-offsets` ConfigMap as the source of offsets for the alter operation, and set the `state` as `stopped`:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
# ...
spec:
  #...
  state: stopped
  alterOffsets:
    fromConfigMap:
      name: my-connector-offsets
  #...
```

The `status` in the `KafkaConnector` is updated once Strimzi has stopped the connector.

Now edit the `my-connector-offsets` ConfigMap to change the `position` to, for example, 10:

```yaml
apiVersion: v1
kind: ConfigMap
# ...
data:
  offsets.json: |-
    {
      "offsets" : [ {
        "partition" : {
          "filename" : "/opt/kafka/LICENSE"
        },
        "offset" : {
          "position" : 10
        }
      } ]
    }
```

Finally trigger the operator to alter offsets by annotating the resource:

```shell
$ kubectl annotate kafkaconnector my-source-connector strimzi.io/connector-offsets=alter -n kafka
```

Strimzi removes the `strimzi.io/connector-offsets` annotation from the resource once the offsets have been successfully updated.
You can also verify this directly:

```shell
$ kubectl exec -n kafka -it my-connect-cluster-connect-0 -- curl localhost:8083/connectors/my-source-connector/offsets
{"offsets":[{"partition":{"filename":"/opt/kafka/LICENSE"},"offset":{"position":10}}]}
```

### Resetting offsets

The final action you can perform is to reset the connector offsets.
For this action the connector also needs to be in a `stopped` state, but you don't need any ConfigMap.

Reset the offsets for your connector by annotating the resource:

```shell
$ kubectl annotate kafkaconnector my-source-connector strimzi.io/connector-offsets=reset -n kafka
```

Once complete the connector offsets will be empty:

```shell
$ kubectl exec -n kafka -it my-connect-cluster-connect-0 -- curl localhost:8083/connectors/my-source-connector/offsets
{"offsets":[]}
```

### Managing offsets for MirrorMaker

In addition to connectors managed via the `KafkaConnector` resource, you can also manage the connectors that are deployed as part of a `KafkaMirrorMaker2` resource.
When using a `KafkaMirrorMaker2` resource the configurations for the ConfigMaps for listing and altering offsets are provided on a per-connector basis. For example:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaMirrorMaker2
metadata:
  name: my-mirror-maker-2
spec:
  # ...
  mirrors:
  - # ...
    sourceConnector:
      listOffsets:
        toConfigMap:
          name: my-connector-offsets
      alterOffsets:
        fromConfigMap:
          name: my-connector-offsets
    # ...
```

Strimzi allows you to list, alter and reset offsets for all the MirrorMaker connectors (MirrorSourceConnector, MirrorCheckpointConnector, MirrorHeartbeatConnector).
However, be aware that the only connector that currently actively uses its offsets is the MirrorSourceConnector.
You may find listing offsets useful for the MirrorCheckpointConnector and MirrorHeartbeatConnector to track progress, but it is uncommon to need to alter or reset offsets for those connectors.

Strimzi only allows you to perform an action on a single connector, in a single mirror at a time.
Therefore, to initiate an action from a `KafkaMirrorMaker2` resource you must apply two annotations:
* strimzi.io/connector-offsets
* strimzi.io/mirrormaker-connector

Set `strimzi.io/connector-offsets` to one of `list`, `alter` or `reset`.
At the same time set `strimzi.io/mirrormaker-connector` to the name of your connector.

Strimzi names the connectors using the format `<SOURCE_ALIAS>-><TARGET_ALIAS>.<CONNECTOR_TYPE>`, for example `east-kafka->west-kafka.MirrorSourceConnector`.

You can use a single command to annotate the resource with both annotations.
For example to list offsets for a connector called `east-kafka->west-kafka.MirrorSourceConnector`:

```shell
$ kubectl annotate kafkaconnector my-source-connector strimzi.io/connector-offsets=list strimzi.io/mirrormaker-connector="east-kafka->west-kafka.MirrorSourceConnector" -n kafka
```

When listing and altering offsets for MirrorMaker connectors, Strimzi uses the connector name in the data field.
For example, the above command to list offsets for the connector `east-kafka->west-kafka.MirrorSourceConnector` results in a ConfigMap containing:

```yaml
apiVersion: v1
kind: ConfigMap
# ...
data:
  east-kafka--west-kafka.MirrorSourceConnector.json: |
    {
      "offsets": [
        {
          "partition": {
            "cluster": "east-kafka",
            "partition": 0,
            "topic": "mirrormaker2-cluster-configs"
          },
          "offset": {
            "offset": 0
          }
        }
      ]
    }
```

### Conclusion

Now you can list, alter and reset offsets of your connectors using the `KafkaConnector` and `KafkaMirrorMaker2` custom resources.

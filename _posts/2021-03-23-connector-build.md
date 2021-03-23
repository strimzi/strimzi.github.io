---
layout: post
title:  "How to build your own KafkaConnect image via custom resource"
date: 2020-03-23
author: jakub_stejskal
---
In one of [the older blog post](https://strimzi.io/blog/2020/05/07/camel-kafka-connectors/) we shown you how easy is to integrate Camel with Strimzi via KafkaConnect custom resource.
That approach had one limitation - you had to build your own KafkaConnect image and use it in custom resource.
However, this step is not needed anymore, thanks to feature which we introduced in Strimzi 0.22 to allow users to build custom KafkaConnect images directly by Strimzi.

### How does it work
Strimzi uses two different ways how to build the image based on the underlying kubernetes cluster:
* In case you use pure Kubernetes, the image will be built by [Kaniko](https://github.com/GoogleContainerTools/kaniko)
* In case you use Openshift, the image will be built by Openshift Builds

In both cases, Strimzi will spin-up a build pod, which builds the image based on the configuration from custom resource.
The final image is then pushed into specific registry or image stream, again based on the configuration. 
The great thing in this feature is, that you can easily reuse the newly built image in another KafkaConnect resource without building it again or manually.

### KafkaConnect configuration
A new `build` configuration for KafkaConnect resource allow you to configure a list of custom connectors, which will be downloaded and baked into a new KafkaConnect images specified by you.

In the example bellow, you can see the configuration of the build part in KafkaConnect:
* (1) - build configuration which contains output information and list of plugins.
* (2) - configuration of registry, where new image will be pushed. 
* (3) - List of plugins, which will be downloaded and added into your specific connect image.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnect
metadata:
  name: my-connect-cluster
  annotations:
    strimzi.io/use-connector-resources: "true"
spec:
  ...
  build: (1)
    output: (2)
      type: docker
      image: my-registry.io/my-org/my-connect-cluster:latest
      pushSecret: my-registry-credentials
    plugins: (3) 
      - name: debezium-postgres-connector
        artifacts:
          - type: tgz
            url: https://repo1.maven.org/maven2/io/debezium/debezium-connector-postgres/1.4.2.Final/debezium-connector-postgres-1.4.2.Final-plugin.zip
            sha512sum: ef1620547e6ddf5be010271849b6a87a19f6e6beee93b379c80883815b8f37ec5137095b2c99975d7704cbf957e6a33d76c61109582cad57c7cbbfae43adc86c
      - name: camel-timer
        artifacts:
          - type: tgz
            url: https://repo.maven.apache.org/maven2/org/apache/camel/kafkaconnector/camel-timer-kafka-connector/0.8.0/camel-timer-kafka-connector-0.8.0-package.tar.gz
            sha512sum: c0102700ae176b1ef078bdb86d640935a1333865e58b870f6b0ef3d9dad067221122aee6bf52852dad209a7c2051f359e0434fc7fbd783fb50e21707c7577ef9
      - name: echo-connector
        artifacts:
          - type: jar
            url: https://github.com/scholzj/echo-sink/releases/download/1.1.0/echo-sink-1.1.0.jar
            sha512sum: b7da48d5ecd1e4199886d169ced1bf702ffbdfd704d69e0da97e78ff63c1bcece2f59c2c6c751f9c20be73472b8cb6a31b6fd4f75558c1cb9d96daa9e9e603d2
```

There is a several possible options which you can configure for the build.
In `output` part, you need to specify output type either to `docker` for push into docker registry like quay.io or to `imagestream` to push image into internal Openshift image stream (openshift only).
Output configuration also require image name and push secret in case the registry are private. 
The secret has to be deployed in the same namespace as KafkaConnect resource.

In `plugins` part, you just need to list all connectors, which you want ot have in your image. 
Again, each item in the list has several options, which you need to specify like `name` of the plugin and `arttifacts` section with info needed for download and work with it.
Artifact `type` could be either `zip`, `tgz` or `jar` and of course has to be same as artifact available on `url`.
`sha512sum` is optional property, which is used for validation of downloaded artifact by Strimzi, if it's specified.

## Quick example

Now lets go through quick example how to make it working in your cluster. 
At first, you have to have Strimzi and Kafka cluster up and running. 
Then you can create KafkaConnect with the following configuration (just change registry and organization in image name and secret):

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnect
metadata:
  name: my-connect-cluster
  annotations:
    strimzi.io/use-connector-resources: "true"
spec:
  replicas: 1
  bootstrapServers: my-cluster-kafka-bootstrap:9092
  config:
    group.id: my-connect-cluster
    offset.storage.topic: my-connect-cluster-offsets
    config.storage.topic: my-connect-cluster-configs
    status.storage.topic: my-connect-cluster-status
    key.converter: org.apache.kafka.connect.json.JsonConverter
    value.converter: org.apache.kafka.connect.json.JsonConverter
    key.converter.schemas.enable: true
    value.converter.schemas.enable: true
    config.storage.replication.factor: 3
    offset.storage.replication.factor: 3
    status.storage.replication.factor: 3
  build:
    output:
      type: docker
      image: my-reg.io/my-org/my-connect-cluster:latest
      pushSecret: my-registry-credentials
    plugins: 
      - name: debezium-postgres-connector
        artifacts:
          - type: zip
            url: https://repo1.maven.org/maven2/io/debezium/debezium-connector-postgres/1.4.2.Final/debezium-connector-postgres-1.4.2.Final-plugin.zip
            sha512sum: ef1620547e6ddf5be010271849b6a87a19f6e6beee93b379c80883815b8f37ec5137095b2c99975d7704cbf957e6a33d76c61109582cad57c7cbbfae43adc86c
      - name: camel-timer
        artifacts:
          - type: tgz
            url: https://repo.maven.apache.org/maven2/org/apache/camel/kafkaconnector/camel-timer-kafka-connector/0.8.0/camel-timer-kafka-connector-0.8.0-package.tar.gz
            sha512sum: c0102700ae176b1ef078bdb86d640935a1333865e58b870f6b0ef3d9dad067221122aee6bf52852dad209a7c2051f359e0434fc7fbd783fb50e21707c7577ef9
      - name: echo-connector
        artifacts:
          - type: jar
            url: https://github.com/scholzj/echo-sink/releases/download/1.1.0/echo-sink-1.1.0.jar
            sha512sum: b7da48d5ecd1e4199886d169ced1bf702ffbdfd704d69e0da97e78ff63c1bcece2f59c2c6c751f9c20be73472b8cb6a31b6fd4f75558c1cb9d96daa9e9e603d2
  template:
    pod:
      imagePullSecrets:
        - name: my-registry-credentials
```

Strimzi will spin-up KafkaConnect build pod and when build is finished, regular KafkaConnect pod will be created.

```shell
NAME                                          READY   STATUS      RESTARTS   AGE
my-cluster-entity-operator-7d7f49cbc-b47cw    3/3     Running     0          4m10s
my-cluster-kafka-0                            1/1     Running     1          4m43s
my-cluster-kafka-1                            1/1     Running     0          4m43s
my-cluster-kafka-2                            1/1     Running     0          4m43s
my-cluster-zookeeper-0                        1/1     Running     1          5m14s
my-cluster-zookeeper-1                        1/1     Running     0          5m14s
my-cluster-zookeeper-2                        1/1     Running     0          5m14s
my-connect-cluster-connect-69bc4bc47c-tvjzh   1/1     Running     0          74s
my-connect-cluster-connect-build-1-build      0/1     Completed   0          2m2s
strimzi-cluster-operator-769f57cb64-7cbvm     1/1     Running     0          6m3s
```

You can also double check the status of KafkaConnect, which will now contains all connectors which you added:

```yaml
...
  status:
    conditions:
    - lastTransitionTime: "2021-03-23T16:31:11.204228Z"
      status: "True"
      type: Ready
    connectorPlugins:
    - class: cz.scholz.kafka.connect.echosink.EchoSinkConnector
      type: sink
      version: 1.0.0
    - class: io.debezium.connector.postgresql.PostgresConnector
      type: source
      version: 1.4.2.Final
    - class: org.apache.camel.kafkaconnector.CamelSinkConnector
      type: sink
      version: 0.8.0
    - class: org.apache.camel.kafkaconnector.CamelSourceConnector
      type: source
      version: 0.8.0
    - class: org.apache.camel.kafkaconnector.timer.CamelTimerSourceConnector
      type: source
      version: 0.8.0
    - class: org.apache.kafka.connect.file.FileStreamSinkConnector
      type: sink
      version: 2.7.0
    - class: org.apache.kafka.connect.file.FileStreamSourceConnector
      type: source
      version: 2.7.0
    - class: org.apache.kafka.connect.mirror.MirrorCheckpointConnector
      type: source
      version: "1"
    - class: org.apache.kafka.connect.mirror.MirrorHeartbeatConnector
      type: source
      version: "1"
    - class: org.apache.kafka.connect.mirror.MirrorSourceConnector
      type: source
      version: "1"
    labelSelector: strimzi.io/cluster=my-connect-cluster,strimzi.io/name=my-connect-cluster-connect,strimzi.io/kind=KafkaConnect
    observedGeneration: 1
    replicas: 1
    url: http://my-connect-cluster-connect-api.kafka.svc:8083
```

Now you can create KafkaConnector resource and use there any of the connectors which you added to the build section.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
metadata:
  name: telegram-connector
  labels:
    strimzi.io/cluster: my-connect-cluster
spec:
  class: org.apache.camel.kafkaconnector.timer.CamelTimerSourceConnector
  tasksMax: 5
  config:
    camel.source.path.timerName: timer
    topics: timer-topic
    value.converter.schemas.enable: false
    transforms: HoistField,InsertField,ReplaceField
    transforms.HoistField.type: org.apache.kafka.connect.transforms.HoistField$Value
    transforms.HoistField.field: originalValue
    transforms.InsertField.type: org.apache.kafka.connect.transforms.InsertField$Value
    transforms.InsertField.timestamp.field: timestamp
    transforms.InsertField.static.field: message
    transforms.InsertField.static.value: 'Hello World'
    transforms.ReplaceField.type: org.apache.kafka.connect.transforms.ReplaceField$Value
    transforms.ReplaceField.blacklist: originalValue
```

You can verify that connector is working by attaching kafka client to a connector topic:
```bash
kubectl -n kafka exec my-cluster-kafka-0 -c kafka -i -t -- bin/kafka-console-consumer.sh  --bootstrap-server localhost:9092 --topic timer-topic

{"schema":null,"payload":{"message":"Hello World","timestamp":1616517487920}}
{"schema":null,"payload":{"message":"Hello World","timestamp":1616517487914}}
{"schema":null,"payload":{"message":"Hello World","timestamp":1616517488925}}
{"schema":null,"payload":{"message":"Hello World","timestamp":1616517488921}}
...
```

The connector generated messages and send them to Kafka where could be consumed by consumers as we see above.

## Conclusion

In that blog post we show you how easily is to setup KafkaConnect with your custom connectors just with kubectl and Strimzi. 
You don't need to download anything.
You don't need to build anything.
You just need to create KafkaConnect and profit from it!

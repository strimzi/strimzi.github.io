---
layout: post
title:  "Building your own Kafka Connect image with a custom resource"
date: 2021-03-29
author: jakub_stejskal
---
In a [previous blog post](https://strimzi.io/blog/2020/05/07/camel-kafka-connectors/) we showed how easy it is to integrate [Camel Kafka Connectors](https://camel.apache.org/camel-kafka-connector/latest/) with Strimzi by configuring a `KafkaConnect` custom resource.
That approach had one limitation - you had to build your own Kafka Connect image and use it in the custom resource.
This step is no longer needed thanks to a feature introduced in Strimzi 0.22 that allows custom Kafka Connect images to be built directly by Strimzi.

<!--more-->

### How does it work?

Strimzi builds the image in two ways based on the underlying cluster.
If you use Kubernetes, the image is built by [kaniko](https://github.com/GoogleContainerTools/kaniko).
kaniko is a tool to build container images from a Dockerfile, inside a container or Kubernetes cluster.
kaniko doesn't depend on a Docker daemon and executes each command within a Dockerfile completely in userspace.
This enables building container images in environments that can't easily or securely run a Docker daemon, such as a standard Kubernetes cluster.
If you use Openshift, the image is built by Openshift Builds.

In both cases, Strimzi will spin-up a build pod, which builds the image based on the configuration from the custom resource.
The final image is then pushed into a specific container registry or image stream, again based on the configuration. 
The Kafka Connect cluster specified by the custom resource with the build configuration part will then use the newly built image.

### Kafka Connect configuration

A new `build` configuration for the `KafkaConnect` resource allows you to configure a list of custom connectors, which are downloaded and _baked into_ a new `KafkaConnect` image specified by you.

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

In this example `KafkaConnect` configuration, you can see the build specification:
* (1) - build configuration which contains output information and list of plugins.
* (2) - configuration of registry, where new image will be pushed.
* (3) - List of plugins, which will be downloaded and added into your specific connect image.

There are a several possible options which you can configure for the build.
For the `output` property, you need to specify the `type` either as `docker` to push into a container registry like Docker Hub or Quay, or as `ImageStream` to push the image into an internal OpenShift registry (OpenShift only).
The output configuration also requires an image name in `image` property.
Optional property is `pushSecret` in case the registry is protected.
The secret has to be deployed in the same namespace as the `KafkaConnect` resource.
You can find more information about how to create this secret in the [Kubernetes documentation](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/#registry-secret-existing-credentials).

For the `plugins` configuration, you need to list all connectors that you want to have in your image.
You can also use this to add custom SMTs or converters.
You need to specify the name of the plugin, and add the information needed to download and work with the plugin using the `artifacts` property.
The artifact `type` can be `zip`, `tgz`, or `jar` and, of course, has to be same as the artifact specified with the `url`.
`sha512sum` is an optional property, which is used for validation of the downloaded artifact by Strimzi.

## Quick example

Now let's go through a quick example of how to make the build work in your cluster.
First, you have to have Strimzi and a Kafka cluster up and running.
Then you can create `KafkaConnect` with the following configuration (just change the registry and organization in the image name and secret):

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
      - name: camel-timer
        artifacts:
          - type: tgz
            url: https://repo.maven.apache.org/maven2/org/apache/camel/kafkaconnector/camel-timer-kafka-connector/0.8.0/camel-timer-kafka-connector-0.8.0-package.tar.gz
            sha512sum: c0102700ae176b1ef078bdb86d640935a1333865e58b870f6b0ef3d9dad067221122aee6bf52852dad209a7c2051f359e0434fc7fbd783fb50e21707c7577ef9
  template:
    pod:
      imagePullSecrets:
        - name: my-registry-credentials
```

Strimzi will spin-up a Kafka Connect build pod, and when the build is finished a regular Kafka Connect pod is created.

```shell
NAME                                          READY   STATUS      RESTARTS   AGE
my-cluster-entity-operator-7d7f49cbc-b47cw    3/3     Running     0          4m10s
my-cluster-kafka-0                            1/1     Running     0          4m43s
my-cluster-kafka-1                            1/1     Running     0          4m43s
my-cluster-kafka-2                            1/1     Running     0          4m43s
my-cluster-zookeeper-0                        1/1     Running     0          5m14s
my-cluster-zookeeper-1                        1/1     Running     0          5m14s
my-cluster-zookeeper-2                        1/1     Running     0          5m14s
my-connect-cluster-connect-69bc4bc47c-tvjzh   1/1     Running     0          74s
my-connect-cluster-connect-build              0/1     Completed   0          2m2s
strimzi-cluster-operator-769f57cb64-7cbvm     1/1     Running     0          6m3s
```

You can also double check the status of the `KafkaConnect` resource, which will now contain all available connectors:

```yaml
...
  status:
    conditions:
    - lastTransitionTime: "2021-03-23T16:31:11.204228Z"
      status: "True"
      type: Ready
    connectorPlugins:
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

Now you can create a `KafkaConnector` resource and use any of the connectors which you added to the build section.

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

You can verify that a source connector is working by attaching a Kafka client to a connector topic:
```bash
kubectl run kafka-producer -ti --image=quay.io/strimzi/kafka:0.22.1-kafka-2.7.0 --rm=true --restart=Never -n kafka -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic timer-topic

{"schema":null,"payload":{"message":"Hello World","timestamp":1616517487920}}
{"schema":null,"payload":{"message":"Hello World","timestamp":1616517487914}}
{"schema":null,"payload":{"message":"Hello World","timestamp":1616517488925}}
{"schema":null,"payload":{"message":"Hello World","timestampmage based on the underlying Kub":1616517488921}}
...
```

The connector generates messages and sends them to Kafka where they are consumed by consumers.

## Conclusion

In this blog post we showed how easy it is to set up Kafka Connect with your custom connectors using only `kubectl` and Strimzi.  
For more information, please see [KafkaConnect build reference](https://strimzi.io/docs/operators/latest/full/deploying.html#creating-new-image-using-kafka-connect-build-str) in our documentation.
You don't need to download anything.
You don't need to build anything.
You just need to create the `KafkaConnect` resource and use it!

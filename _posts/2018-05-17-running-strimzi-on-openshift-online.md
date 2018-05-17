---
layout: post
title:  "Running Strimzi on OpenShift Online"
date: 2018-05-17
author: "Jakub Scholz"
---

OpenShift Online is a managed OpenShift as a Service offering from Red Hat. It has a Starter tier and Pro tier.
The Starter tier is for free, but offers only very limited resources.
In the Pro tier, you can buy additional resources.
Can it be used to run Apache Kafka using the Strimzi project?
Of course it can.
But OpenShift Online has some limitations.
So we will need to do some modifications to the default Strimzi installation files to get it up and running.

<!--more-->

Since OpenShift Online is a managed service, you will not get an account with cluster admin access.
You will be only admin of the projects which you create.
As such, you will be unable to create new roles.
To follow the principle of least privilege, the default installation of Strimzi creates a new role which contains only the exact access rights which are needed by Strimzi.
But OpenShift Online will not let you create such role.
So instead, we need to reuse one of the existing roles.
The `edit` cluster role is suitable for this, since it contains all the privileges Strimzi needs to watch and manage resources.
This role has to be used in the role binding to give the Strimzi service account the required access rights.
When deploying Strimzi to the Starter tier, we need to minimise the memory consumption, because we have in total only 1GB of memory for deployments and stateful sets.
For that, we need to carefully configure the memory we give to the Cluster Operator.
From my experience, 192Mi of memory is the amount which will keep it running stable.
The example YAML files below can be used to deploy Cluster Operator to OpenShift Online:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: strimzi-cluster-operator
  labels:
    app: strimzi
---
apiVersion: rbac.authorization.k8s.io/v1beta1
kind: RoleBinding
metadata:
  name: strimzi-cluster-operator-binding
  labels:
    app: strimzi
subjects:
  - kind: ServiceAccount
    name: strimzi-cluster-operator
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: strimzi-cluster-operator
spec:
  replicas: 1
  template:
    metadata:
      labels:
        name: strimzi-cluster-operator
    spec:
      serviceAccountName: strimzi-cluster-operator
      containers:
        - name: strimzi-cluster-operator
          image: strimzi/cluster-operator:0.4.0
          env:
            - name: STRIMZI_CONFIGMAP_LABELS
              value: "strimzi.io/kind=cluster"
            - name: STRIMZI_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: STRIMZI_FULL_RECONCILIATION_INTERVAL_MS
              value: "120000"
            - name: STRIMZI_OPERATION_TIMEOUT_MS
              value: "300000"
            - name: STRIMZI_DEFAULT_ZOOKEEPER_IMAGE
              value: strimzi/zookeeper:0.4.0
            - name: STRIMZI_DEFAULT_KAFKA_IMAGE
              value: strimzi/kafka:0.4.0
            - name: STRIMZI_DEFAULT_KAFKA_CONNECT_IMAGE
              value: strimzi/kafka-connect:0.4.0
            - name: STRIMZI_DEFAULT_KAFKA_CONNECT_S2I_IMAGE
              value: strimzi/kafka-connect-s2i:0.4.0
            - name: STRIMZI_DEFAULT_TOPIC_OPERATOR_IMAGE
              value: strimzi/topic-operator:0.4.0
          livenessProbe:
            httpGet:
              path: /healthy
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
          resources:
            limits:
              memory: 192Mi
              cpu: 1000m
            requests:
              memory: 192Mi
              cpu: 100m
  strategy:
    type: Recreate
```

Once you apply this YAML, Cluster Operator should deploy and start watching for config maps.
Creating the Kafka cluster works in the same way as everywhere else.
You just prepare the config map and the Cluster Operator will deploy Kafka accordingly.
However, there are some things which you have to be careful about.
OpenShift Online is using a Limit Range which will set the default resource requests and limits in case there aren't any specified by the Pods.
So even on the Pro tier with more memory, you should always set the resource requests and limits to avoid the defaults.
The example config map below shows a deployment which should work on the Starter tier.
It is using only one node for Zookeeper and one for Kafka. And the resources are very constrained.
If you are on Pro tier, you should definitely increase the numbers ;-).
The cluster described below is also using only ephemeral storage.
So any data will not survive restarts or crashes of the Pods.
The Starter tier can have only one persistent disk, that is why we have chosen ephemeral storage.
On Pro tier you should be able to use persistent storage as well.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  labels:
    strimzi.io/kind: cluster
    strimzi.io/type: kafka
  name: my-cluster
data:
  kafka-config: |-
    {
      "num.partitions": 1,
      "num.recovery.threads.per.data.dir": 1,
      "default.replication.factor": 1,
      "offsets.topic.replication.factor": 1,
      "transaction.state.log.replication.factor": 1,
      "transaction.state.log.min.isr": 1,
      "log.retention.hours": 168,
      "log.segment.bytes": 1073741824,
      "log.retention.check.interval.ms": 300000,
      "num.network.threads": 3,
      "num.io.threads": 8,
      "socket.send.buffer.bytes": 102400,
      "socket.receive.buffer.bytes": 102400,
      "socket.request.max.bytes": 104857600,
      "group.initial.rebalance.delay.ms": 0
    }
  kafka-healthcheck-delay: '15'
  kafka-healthcheck-timeout: '5'
  kafka-jvmOptions: |-
    {
      "-Xmx": "256M",
      "-Xms": "256M"
    }
  kafka-nodes: '1'
  kafka-resources: |-
    {
      "requests": {
        "cpu": "200m",
        "memory": "512Mi"
      },
      "limits": {
        "cpu": "1",
        "memory": "512Mi"
      }
    }
  kafka-storage: '{ "type": "ephemeral" }'
  topic-operator-config: |-
    { 
      "resources": {
        "requests": {
          "cpu": "100m",
          "memory": "128Mi"
        },
        "limits": {
          "cpu": "1",
          "memory": "128Mi"
        }
      }
    }
  zookeeper-healthcheck-delay: '15'
  zookeeper-healthcheck-timeout: '5'
  zookeeper-nodes: '1'
  zookeeper-resources: |-
    {
      "requests": {
        "cpu": "200m",
        "memory": "128Mi"
      },
      "limits": {
        "cpu": "1",
        "memory": "128Mi"
      }
    }
  zookeeper-storage: '{ "type": "ephemeral" }'
```

Once you create the config map, Cluster Operator should start immediately deploying the components - Zookeeper, Kafka broker and Topic Operator.
Once they are deployed, you can start using your new Kafka cluster.
Well ... almost. If you are on the Pro tier, you can now actually deploy your applications using Kafka.
On the Starter tier, the cluster consumed most of your memory and CPU.
So, how can you test that the cluster works? We can use Kubernetes Jobs for it.
OpenShift Online Starter gives us another 1GB of so called "terminating" memory.
This memory can be used for things such as builds or jobs which have active deadline.
We can use this to deploy Kafka Producer and Kafka Consumer.
They will each send / receive defined amount of messages and terminate.

But before we can deploy the producer and consumer, we have to create the topic.
The topic can be created by deploying the following config map:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-job-topic
  labels:
    strimzi.io/kind: topic
    strimzi.io/cluster: my-cluster
data:
  name: my-job-topic
  partitions: "1"
  replicas: "1"
  config: |-
    {
      "retention.bytes": "1073741824",
      "retention.ms": "86400000",
      "segment.bytes": "1073741824"
    }
```

This config map will be picked by the Topic Operator, which will create a new topic named "my-job-topic" with one partition and one replica.
With the topic being ready, we can now deploy the jobs.
The producer job will send in total 1000 messages at a speed of approximately one message per second.
After it sends all 1000 messages it will terminate. You can follow the progress in the log.
The consumer job will be consuming the messages sent by the producer job.
Once it receives all 1000 messages, it will also terminate.
These jobs will verify that our Kafka deployment really works.
The YAML below can be used to deploy both jobs.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  labels:
    app: kafka-producer-job
  name: kafka-producer-job
spec:
  parallelism: 1
  completions: 1
  backoffLimit: 5
  template:
    metadata:
      labels:
        app: kafka-producer
    spec:
      containers:
      - name: kafka-producer
        image: scholzj/kafka-producer:latest
        env:
          - name: BOOTSTRAP_SERVERS
            value: my-cluster-kafka:9092
          - name: TOPIC
            value: my-job-topic
          - name: TIMER
            value: "1000"
          - name: NUMBER_OF_KEYS
            value: "1"
          - name: MESSAGE_COUNT
            value: "1000"
      restartPolicy: OnFailure
---
apiVersion: batch/v1
kind: Job
metadata:
  labels:
    app: kafka-consumer-job
  name: kafka-consumer-job
spec:
  parallelism: 1
  completions: 1
  backoffLimit: 5
  template:
    metadata:
      labels:
        app: kafka-consumer
    spec:
      containers:
      - name: kafka-consumer
        image: scholzj/kafka-consumer:latest
        env:
          - name: BOOTSTRAP_SERVERS
            value: my-cluster-kafka:9092
          - name: TOPIC
            value: my-job-topic
          - name: GROUP_ID
            value: my-kafka-consumer
          - name: MESSAGE_COUNT
            value: "1000"
      restartPolicy: OnFailure
```

OpenShift Online is a nice service.
But the Starter tier is obviously too limited for any serious project - at least one using Apache Kafka.
We cann't deploy there a proper cluster with multiple nodes and sufficient memory for some real work.
But if you want to give Strimzi a quick try and do not want to bother with running your own cluster, you can give it a try.
It will show you the basic principles how the Strimzi operators work.
If you are on the paid Pro tier you can get lot more resources.
And if needed, you can deploy bigger clusters together with applications using them.
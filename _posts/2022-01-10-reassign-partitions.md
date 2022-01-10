---
layout: post
title:  "Reassign partitions in Kafka Cluster"
date: 2021-09-23
author: shubham_rawat
---

Scaling down Kafka Brokers and increasing the number of topics and partitions are all pretty common tasks for Kafka users. Let's take a case for eg. There are certain brokers in a cluster and now we want to remove a broker from the cluster. We need to make sure that the broker which is going to be removed should not have any assigned partitions. Now we require a tool which can assign the partitions from the broker to be scaled down to the brokers which should be responsible for handling these partitions. The most convenient tool for this job is the reassignment partition tool: `kafka-reassign-partitions.sh`.

<!--more-->

## Partition Reassignment tool

Within a broker pod, the `bin/kafka-reassign-partitions.sh` tool allows you to reassign partitions to different brokers.

It has three different modes:

| Mode | Description |
| :-----------: | ------------- |
| `generate`  | Takes a set of topics and brokers and generates a reassignment JSON file which will result in the partitions of those topics being assigned to those brokers. Because this operates on whole topics, it cannot be used when you only want to reassign some partitions for some topics.|
| `execute` | Takes a reassignment JSON file and applies it to the partitions and brokers in the cluster. The `reassignment.json` file can be either the one proposed by the `--generate` command or written by the user itself. |
| `verify`  | Using the same reassignment JSON file as the `--execute` step, `--verify` checks whether all the partitions in the file have been moved to their intended brokers. If the reassignment is complete, `--verify` also removes any traffic throttles (`--throttle`) that are in effect. Unless removed, throttles will continue to affect the cluster even after the reassignment has finished. |

While using the tool, you have to provide it with two essential JSON files: `topics.json` and `reassignment.json`.
Wondering what these two JSON files really do? Let's talk a bit about them:

- The `topic.json` basically consists of the topics that we want to reassign or move. Based on this JSON file, our tool will generate a proposal `reassignment.json` which we can further change as per our requirements or use directly.
  
- The `reassignment.json` file is a configuration file which is used during the partition reassignment process. The reassignment partition tool will give us a proposal `reassignment.json` file when we feed it with the `topics.json` file. We can change the `reassignment.json` file as per our requirement and use it.

## Why use the Partition Reassignment tool?

The Partition Reassignment tool can help you address a variety of use cases.

Some of these are listed here :-

1. It can be used at times when you want to scale down your cluster.
   You can assign partitions from the broker to be scaled down to other brokers which will handle these partition to your clusters.
   
2. We all know that the best way to increase throughput for the topic is to increase the no. of partitions for that topic. You can use this tool to increase the no. of partitions/replicas. 
   
## Example time

Let's have a look at an example which will show us how we can use the partition reassignment tool.
In this example we will be taking a look at how the `--generate` mode of the partition reassignment tool is used.
We will generate the JSON data which will be used in the `reassignment.json` file.
Later on, we will see that how we scale down the cluster using the generated `reassignment.json` file.
The Kafka Cluster that we will use will be configured to use TLS encryption, and we will be using simple authentication.
The configurations can be changed accordingly. Strimzi provides us with many authentication types like *TLS*, *SCRAM-SHA-512*, *OAUTH* and *PLAIN*.

### Preparation

This example will use a Kafka cluster deployed with the Strimzi Cluster Operator.
Before we start with anything, we have to install the Strimzi Cluster Operator and deploy the Kafka cluster.
You can install the Cluster Operator with any installation method you prefer.
And then deploy the Kafka cluster with the TLS client authentication enabled on port 9093.

Example Kafka configuration for TLS authentication
```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    replicas: 3
    listeners:
      - name: tls
        port: 9093
        type: internal
        tls: true
        authentication:
          type: tls
    authorization:
      type: simple
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
    storage:
      type: jbod
      volumes:
      - id: 0
        type: persistent-claim
        size: 100Gi
        deleteClaim: true
  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 100Gi
      deleteClaim: true
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

Once the cluster is running, lets deploy some topics where we will send and receive the messages.
Here is an example topic configuration. You can change it to suit your requirements.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: my-topic
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 10
  replicas: 3
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
    # ...
```

Now we require a kafka user.
We will configure the user for TLS client authentication and configure authorization to allow it to send and receive examples from a topics named `my-topic` and 
`my-topic-1`:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: my-user
  labels:
    strimzi.io/cluster: my-cluster
spec:
  authentication:
    type: tls
  authorization:
    type: simple
    acls:
      - resource:
          type: topic
          name: my-topic
          patternType: literal
        operation: Write
        host: "*"
      - resource:
          type: topic
          name: my-topic-1
          patternType: literal
        operation: Read
        host: "*"
      - resource:
          type: topic
          name: my-topic
          patternType: literal
        operation: Describe
        host: "*"        
      - resource:
          type: topic
          name: my-topic-1
          patternType: literal
        operation: Describe
        host: "*"
  # ...
```

### Procedure

Once you have a running cluster with topics and the brokers, now you are ready to create the proposal json data.
The fist step would be to extract the certificates and key for the cluster and the user in order to authenticate using Tls client authentication.

Let us proceed toward extracting the cluster CA certificate and password.
We can extract both of them easily from the `<CLUSTER-NAME>-cluster-ca-cert` Secret (where `<CLUSTER-NAME>` denotes the name of the cluster) using the following commands:

```sh
kubectl get secret CLUSTER-NAME-cluster-ca-cert -o jsonpath='{.data.ca\.p12}' | base64 -d > ca.p12
```

```sh
kubectl get secret CLUSTER-NAME-cluster-ca-cert -o jsonpath='{.data.ca\.password}' | base64 -d > ca.password
```

Before proceeding toward extracting the user credentials, create a separate interactive pod.
This interactive pod will be used to run all the reassignment commands. 
One question might bug you. What is the need of a separate pod? Can't We use one of the broker pods?
The answer to this is running commands from within a broker is not a good practice and is insecure. So it is always better to avoid running the command from a broker pod.

So now it's time to get our interactive pod up and running. You can use the following command:

```sh
kubectl run --restart=Never --image=quay.io/strimzi/kafka:latest-kafka-2.8.0 <interactive_pod_name> -- /bin/sh -c "sleep 3600"
```

Wait till the pod gets into the `Ready` state. Once the pod gets into `Ready` state, now our next step will be to copy the CA certificate to the interactive pod container:

```sh
kubectl cp ca.p12 <interactive_pod_name>:/tmp
```

We can now proceed to fetch the User certificate and password for the user. User certificate and password are extracted from the User Secret like this :

```sh
kubectl get secret <kafka_user> -o jsonpath='{.data.user\.p12}' | base64 -d > user.p12
```

```sh
kubectl get secret <kafka_user> -o jsonpath='{.data.user\.password}' | base64 -d > user.password
```

Copy the User CA certificates to the interactive pod container.

```sh
kubectl cp user.p12 <interactive_pod_name>:/tmp
```

The interactive pod now has both user and cluster CA certificates. 

Next, we will configure the Kafka clients to connect to our Kafka cluster and authenticate.
The truststore and the keystore location are mapped to their respective location (which is the folder inside the interactive pod container, since all of our commands will be executed inside the shell process of the interactive pod).
And the configuration provider will use these values.
We will also configure the `bootstrap.servers` option to make it easier to change address to connect to the Kafka cluster.

```properties
bootstrap.servers=<kafka_cluster_name>-kafka-bootstrap:9093
security.protocol=SSL
ssl.truststore.location=/tmp/ca.p12
ssl.truststore.password=<truststore_password_present_in_ca_password_file>
ssl.keystore.location=/tmp/user.p12
ssl.keystore.password=<keystore_password_present_in_user_password_file>
```

Now we will copy the `config.properties` file to the interactive pod container:

```sh
kubectl cp config.properties <interactive_pod_name>:/tmp/config.properties
```

Lets create a `topics.json` file now. As we discussed above this file will have the topics that we need to reassign:

```json
{
  "version": 1,
  "topics": [
    { "topic": "my-topic-1"},
    { "topic": "my-topic-2"}
  ]
}
```

After the creation of this file, copy it to the interactive pod container since we will be running all of our commands from there:

```sh
kubectl cp topics.json <interactive_pod_name>:/tmp/topics.json
```

We can now start a shell process in our interactive pod container and run the command inside it to generate our proposal `reassignment.json` data.
Let us start the shell process:

```sh
kubectl exec -ti <interactive_pod_name> /bin/bash
```

Now it's time for the final step. 
We will use the `kafka-reassign-partitions.sh` command to generate our proposal `reassignment.json` data:

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server my-cluster-kafka-bootstrap:9093 \
--command-config /tmp/config.properties \
--topics-to-move-json-file /tmp/topics.json \
--broker-list 0,1,2 \
--generate
```

Once you run this command, you will be able to see the JSON data which is generated by the partition reassignment tool.
Now you can copy and save this data to use in the `reassignment.json` file.

### Scaling down the cluster

Coming to the last step of this example, Here we will see how we use the genenerated `reassignment.json` to get the reassignment done by the reassignment partition tool

Since we have generated the `reassignment.json` file in the previous step, now we can use it for our next step. We can change it as per our requirement.

Lets copy the `reassignment.json` file to the interactive pod container.

```sh
kubectl cp reassignment.json <interactive_pod_name>:/tmp/reassignment.json
```

Now we will start a shell process inside the interactive pod container in which we will run our kafka bin script.
```sh
kubectl exec -ti <interactive_pod_name> /bin/bash
```

So lets run the `kafka-reassign-partitions.sh` script now to start the partition reassignment 

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server
 <cluster_name>-kafka-bootstrap:9093 
 --command-config /tmp/config.properties
 --reassignment-json-file /tmp/reassignment.json 
 --execute
```

Now you can use the `--verify` mode to check if the partition reassignment is done or if it is still running.

```sh
bin/kafka-reassign-partitions.sh --bootstrap-server
  <cluster_name>-kafka-bootstrap:9093 \
  --command-config /tmp/config.properties \
  --reassignment-json-file /tmp/reassignment.json \
  --verify
```
The `--verify` mode reports if the assignemnt is done or not.

Once the partition reassignment is complete the broker which were required to be scaled down will have no assigned partition and can be removed safely.

# Conclusion and What lies beyond the example

This example  gave you a briefing on how to use all the 3 mode of the tool which are `--generate`, `--execute` and `--verify` which are the most essential things we should know before doing any reassignment of partitions.

You can also take a look at our documentation on the use of partition reassignment file for [Scaling up the Kafka cluster](https://strimzi.io/docs/operators/in-development/using.html#proc-scaling-up-a-kafka-cluster-str) and [Scaling down the Kafka cluster](https://strimzi.io/docs/operators/in-development/using.html#proc-scaling-down-a-kafka-cluster-str).

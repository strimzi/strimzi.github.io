# Deploy Strimzi using installation files

Before deploying the Strimzi cluster operator, create a namespace called `kafka`:

```shell
kubectl create namespace kafka
```

Apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for the custom resources (CRs, such as `Kafka`, `KafkaTopic` and so on) you will be using to manage Kafka clusters, topics and users.

```shell
kubectl create -f 'https://strimzi.io/install/latest?namespace=kafka' -n kafka
```

The YAML files for `ClusterRoles` and `ClusterRoleBindings` downloaded from strimzi.io contain a default namespace of `myproject`.
The query parameter `namespace=kafka` updates these files to use `kafka` instead.
By specifying `-n kafka` when running `kubectl create`, the definitions and configurations without a namespace reference are also installed in the `kafka` namespace.
If there is a mismatch between namespaces, then the Strimzi cluster operator will not have the necessary permissions to perform its operations.

Follow the deployment of the Strimzi cluster operator:
```shell
kubectl get pod -n kafka --watch
```

You can also follow the operator's log:
```shell
kubectl logs deployment/strimzi-cluster-operator -n kafka -f
```

Once the operator is running it will watch for new custom resources and create the Kafka cluster, topics or users that correspond to those custom resources.

# Create an Apache Kafka cluster

Create a new Kafka custom resource to get a small persistent Apache Kafka Cluster with a one node:

```shell
# Apply the `Kafka` Cluster CR file
kubectl apply -f https://strimzi.io/examples/latest/kafka/kraft/kafka-single-node.yaml -n kafka 
```

Wait while Kubernetes starts the required pods, services, and so on:

```shell
kubectl wait kafka/my-cluster --for=condition=Ready --timeout=300s -n kafka 
```

The above command might timeout if you're downloading images over a slow connection. If that happens you can always run it again.

# Send and receive messages

With the cluster running, run a simple producer to send messages to a Kafka topic (the topic is automatically created):

```shell
kubectl -n kafka run kafka-producer -ti --image=quay.io/strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-producer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic
```

Once everything is set up correctly, you'll see a prompt where you can type in your messages:
```shell
If you don't see a command prompt, try pressing enter.

>Hello Strimzi!
```

And to receive them in a different terminal, run:

```shell
kubectl -n kafka run kafka-consumer -ti --image=quay.io/strimzi/kafka:{{site.data.releases.operator[0].version}}-kafka-{{site.data.releases.operator[0].defaultKafkaVersion}} --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic my-topic --from-beginning
```
If everything works as expected, you'll be able to see the message you produced in the previous step:
```shell
If you don't see a command prompt, try pressing enter.

>Hello Strimzi!
```

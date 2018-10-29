# Starting Minikube 

This assumes that you have the latest version of the `minikube` binary, which you can get [here](https://kubernetes.io/docs/setup/minikube/#installation).

```shell
minikube start --memory=8192 --cpus=4 \
  --kubernetes-version=v1.12.1 \
  --vm-driver=kvm2 \
  --bootstrapper=kubeadm \
  --extra-config=apiserver.enable-admission-plugins="LimitRanger,NamespaceExists,NamespaceLifecycle,ResourceQuota,ServiceAccount,DefaultStorageClass,MutatingAdmissionWebhook"
```

This will start a local installation of Minikube. Once this is completed, let's create our `kafka` namespace:

```shell
kubectl create namespace kafka 
```

# Applying Strimzi installation file

Next we apply the Strimzi install files, including `ClusterRoles`, `ClusterRoleBindings` and some **Custom Resource Definitions** (`CRDs`). The CRDs define the schemas used for declarative management of the Kafka cluster, Kafka topics and users.

```shell
curl -L https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.8.1/strimzi-cluster-operator-0.8.1.yaml \
  | sed 's/namespace: .*/namespace: kafka/' \
  | kubectl -n kafka apply -f -
```

# Provision the Apache Kafka cluster

After that we feed Strimzi with a simple **Custom Resource**, which will than give you a simple, ephemeral Apache Kafka Cluster:

```shell
# Apply the `Kafka` Cluster CR file
kubectl apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/0.8.1/examples/kafka/kafka-ephemeral.yaml -n kafka
```

We can now watch the deployment on the `kafka` namespace, and see all required pods being created:

```shell
kubectl get pods -n kafka -w
```

Enjoy your Apache Kafka cluster, running on Minikube!

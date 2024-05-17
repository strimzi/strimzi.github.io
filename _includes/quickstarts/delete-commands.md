# Deleting your Apache Kafka cluster

When you are finished with your Apache Kafka cluster, you can delete it by running:

```shell
kubectl -n kafka delete $(kubectl get strimzi -o name -n kafka)
```

This will remove all Strimzi custom resources, including the Apache Kafka cluster and any KafkaTopic custom resources but leave the Strimzi cluster operator running so that it can respond to new Kafka custom resources.

Next, delete the Persistent Volume Claim (PVC) that was used by the cluster:

```shell
kubectl delete pvc -l strimzi.io/name=my-cluster-kafka -n kafka
```

Without deleting the PVC, the next Kafka cluster you might start will fail as it will try to use the volume that belonged to the previous Apache Kafka cluster.

# Deleting the Strimzi cluster operator

When you want to fully remove the Strimzi cluster operator and associated definitions, you can run:

```shell
kubectl -n kafka delete -f 'https://strimzi.io/install/latest?namespace=kafka'
```

# Deleting the `kafka` namespace

Once it is not used, you can also delete the Kubernetes namespace:

```shell
kubectl delete namespace kafka
```

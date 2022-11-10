# Deleting your Apache Kafka cluster

When you are finished with your Apache Kafka cluster, you can delete it by running:

```shell
kubectl -n kafka delete $(kubectl get strimzi -o name -n kafka)
```

This will remove all Strimzi custom resources, including the Apache Kafka cluster and any KafkaTopic custom resources but leave the Strimzi cluster operator running so that it can respond to new Kafka custom resources.

# Deleting the Strimzi cluster operator

When you want to fully remove the Strimzi cluster operator and associated definitions, you can run:

```shell
kubectl -n kafka delete -f 'https://strimzi.io/install/latest?namespace=kafka'
```
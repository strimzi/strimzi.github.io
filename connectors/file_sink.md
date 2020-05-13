#### INSTALLATION

The required JAR file for the FileStreamSinkConnector is pre-installed in the Strimzi images.
 
Create a Custom Resource with the following contents (sink-connector.yaml):

```
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaConnector
metadata:
  name: my-sink-connector 
  labels:
    strimzi.io/cluster: my-connect-cluster 
spec:
  class: org.apache.kafka.connect.file.FileStreamSinkConnector 
  tasksMax: 2 
  config: 
    file: "/path/to/sink-file"
    topic: my-topic
```

Deploy the Custom Resource to your Kubernetes cluster:
```
kubectl apply -f sink-connector.yaml
```

Check that the resource was created:
```
kubectl get kctr --selector strimzi.io/cluster=my-connect-cluster
```

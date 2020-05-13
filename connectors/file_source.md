#### INSTALLATION

The required JAR file for the FileStreamSourceConnector is pre-installed in the Strimzi images.

Create a Custom Resource with the following contents (source-connector.yaml):

```
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaConnector
metadata:
  name: my-source-connector 
  labels:
    strimzi.io/cluster: my-connect-cluster 
spec:
  class: org.apache.kafka.connect.file.FileStreamSourceConnector 
  tasksMax: 2 
  config: 
    file: "/path/to/source-file"
    topic: my-topic
```

Deploy the Custom Resource to your Kubernetes cluster
```
kubectl apply -f source-connector.yaml
```

Check that the resource was created:
```
kubectl get kctr --selector strimzi.io/cluster=my-connect-cluster
```

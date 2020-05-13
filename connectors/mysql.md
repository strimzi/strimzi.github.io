#### INSTALLATION

[Download](https://repo1.maven.org/maven2/io/debezium/debezium-connector-mysql/1.1.0.Final/debezium-connector-mysql-1.1.0.Final-plugin.tar.gz) and extract the Debezium MySQL connector archive.
 
Create a KafkaConnect image that includes the connector archive. Use the following example Dockerfile:

```
FROM strimzi/kafka:0.16.1-kafka-2.4.0
USER root:root
RUN mkdir -p /opt/kafka/plugins/debezium
COPY ./debezium-connector-mysql/ /opt/kafka/plugins/debezium/
USER 1001
```

Build an image from this Dockerfile and push to your repository.

``` 
docker build . -t <docker-org>/connect-debezium-mysql
docker push <docker-org>/connect-debezium-mysql
```

Create a KafkaConnect cluster based on the image you created using the following Custom Resource (kafka-connect.yaml):

```
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaConnect
metadata:
  name: my-connect-cluster
  annotations:
    strimzi.io/use-connector-resources: "true"
spec:
  image: <docker-org>/connect-debezium-mysql
  replicas: 1
  bootstrapServers: <strimzi-cluster-name>-kafka-bootstrap:9093
  tls:
    trustedCertificates:
      - secretName: <strimzi-cluster-name>-cluster-ca-cert
        certificate: ca.crt
  config:
    config.storage.replication.factor: 1
    offset.storage.replication.factor: 1
    status.storage.replication.factor: 1
 
kubectl create -f kafka-connect.yaml
```

Create a Custom Resource for the Connector with the following contents (mysql-connector.yaml):

```
apiVersion: "kafka.strimzi.io/v1alpha1"
kind: "KafkaConnector"
metadata:
  name: "mysql-connector"
  labels:
    strimzi.io/cluster: my-connect-cluster
spec:
  class: io.debezium.connector.mysql.MySqlConnector
  tasksMax: 1
  config:
    database.hostname: "<db-hostname>"
    database.port: "<db-port>"
    database.user: "<db-username>" [1]
    database.password: "<db-password>" [2]
    database.server.id: "184054"
    database.server.name: "dbserver1"
    database.whitelist: "<db-tablename>"
    database.history.kafka.bootstrap.servers: "<strimzi-cluster-name>-kafka-bootstrap:9092"
    database.history.kafka.topic: <topic-name>
    include.schema.changes: "true"
```

[1] [2] Can be injected from a Secret to avoid having plaintext username and password in the resource. For more information: <https://strimzi.io/2020/01/27/deploying-debezium-with-kafkaconnector-resource.html>

Deploy the Custom Resource to your Kubernetes cluster:
```
kubectl apply -f mysql-connector.yaml
```

Check that the resource was created:
```
kubectl get kctr --selector strimzi.io/cluster=my-connect-cluster -o yaml
``` 

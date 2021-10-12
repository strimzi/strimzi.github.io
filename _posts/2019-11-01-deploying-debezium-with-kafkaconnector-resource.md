---
layout: post
title:  "Deploying Debezium using the new KafkaConnector resource"
date: 2020-01-27
author: tom_bentley
---

For too long our Kafka Connect story hasn't been quite as "Kubernetes-native" as it could have been.
We had a `KafkaConnect` resource to configure a Kafka Connect _cluster_ but you still had to use the Kafka Connect REST API to actually create a _connector_ within it.
While this wasn't especially difficult using something like `curl`, it stood out because everything else could be done using `kubectl` and it meant that connectors didn't fit into our Kubernetes-native vision.
With the help of a contribution from the community, Strimzi now supports a `KafkaConnector` custom resource and the rest of this blog post is going to explain how to use it using [Debezium](https://debezium.io) as an example. 
As if that wasn't enough, there's some awesome ASCII art to help explain how it all fits together. So read on to find out about this new Kubernetes-native way of managing connectors.

<!--more-->

# Debezi-what?

If you haven't heard of Debezium before, it is an open source project for applying the [Change Data Capture](https://en.wikipedia.org/wiki/Change_data_capture) (CDC) pattern to your applications using Kafka.

But what is CDC? You probably have several databases in your organization; silos full of business-critical data.
While you can query those databases any time you want, the essence of your business revolves around how that data gets modified.
Those modifications trigger, and are triggered by, real world business events (e.g. a phone call from a customer, or a successful payment or whatever)
In order to reflect this, modern application architectures are frequently event-based. 
And so asking for the _current state_ of some tables is not enough; what these architectures need is a stream of _events representing modifications_ to those tables.
That's what CDC is: Capturing the changes to the state data as event data.

Concretely, Debezium works with a number of common DBMSs (MySQL, MongoDB, PostgreSQL, Oracle, SQL Server and Cassandra) and runs as a source connector within a Kafka Connect cluster.
How Debezium works on the database side depends which database it's using.
For example for MySQL it reads the commit log in order to know what transactions are happening, but for MongoDB it hooks into the native replication mechanism.
In any case, the changes get represented by default as JSON events (other serializations are also possible) which are sent to Kafka.

It should be apparent, then, that Debezium provides a route for getting events out of database applications (which otherwise might not expose any kind of event-based API) and make them available to Kafka applications.

So that's what Debezium _is_ and what it _does_. Its role in this blog post is just to be an example connector to use with the `KafkaConnector` which is new in Strimzi 0.16.

Let's get cracking with the walkthrough...

# Fire up MySQL

Let's follow the steps from the [Debezium tutorial](https://debezium.io/documentation/reference/1.0/tutorial.html) for getting a demo MySQL server up and running.

First we fire up the database server in a Docker container:

```shell
docker run -it --rm --name mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=debezium -e MYSQL_USER=mysqluser \
  -e MYSQL_PASSWORD=mysqlpw debezium/example-mysql:1.0
```

Once we see the following we know the server is ready:

```shell
...
2020-01-24T12:20:18.183194Z 0 [Note] mysqld: ready for connections.
Version: '5.7.29-log'  socket: '/var/run/mysqld/mysqld.sock'  port: 3306  MySQL Community Server (GPL)
```

Then, in another terminal, we can run the command line client:

```shell
docker run -it --rm --name mysqlterm --link mysql --rm mysql:5.7 sh \
  -c 'exec mysql -h"$MYSQL_PORT_3306_TCP_ADDR" \
  -P"$MYSQL_PORT_3306_TCP_PORT" \
  -uroot -p"$MYSQL_ENV_MYSQL_ROOT_PASSWORD"'
```

At the `mysql>` prompt we can switch to the "inventory" database and show the tables in it:

```shell
mysql> use inventory;
mysql> show tables;
```

The output will look like this:

```shell
+---------------------+
| Tables_in_inventory |
+---------------------+
| addresses           |
| customers           |
| geom                |
| orders              |
| products            |
| products_on_hand    |
+---------------------+
6 rows in set (0.01 sec)
```

> Don't worry, this isn't the awesome ASCII art.

If you want, you can have a poke around this demo database, but when you're done leave this MySQL client running in its own terminal window, so you can come back to it later.

# Create a Kafka cluster

Now we can follow some of the [Strimzi quickstart](https://strimzi.io/quickstarts/minikube/) to create a Kafka cluster running inside `minikube`.

First start minikube:

```shell
minikube start --memory=4096
```

When the command finishes you can create a namespace for the resources we're going to create:

```shell
kubectl create namespace kafka
```

Then install the cluster operator and associated resources:

```shell
curl -L https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.16.1/strimzi-cluster-operator-0.16.1.yaml \
  | sed 's/namespace: .*/namespace: kafka/' \
  | kubectl apply -f - -n kafka 
```

And spin up a Kafka cluster, waiting until it's ready:

```shell
kubectl -n kafka \
    apply -f https://raw.githubusercontent.com/strimzi/strimzi-kafka-operator/0.16.1/examples/kafka/kafka-persistent-single.yaml \
  && kubectl wait kafka/my-cluster --for=condition=Ready --timeout=300s -n kafka
```

This can take a while, depending on the speed of your connection.

What we've got so far looks like this

<pre style="line-height: 1.2 !important;"><code>
┌────────────────────────────────┐         ┌────────────────────────────────┐
│ minikube, namespace: kafka     │         │ docker                         │
│                                │         │                                │
│ Kafka                          │         │ MySQL                          │
│  name: my-cluster              │         │                                │
│                                │         └────────────────────────────────┘
│                                │
│                                │
│                                │
└────────────────────────────────┘
</code></pre>

> Don't worry, the ASCII art gets a lot better than this!

What's missing from this picture is Kafka Connect in the minikube box.

# Kafka Connect image

The next step is to [create a Strimzi Kafka Connect image](https://strimzi.io/docs/master/#creating-new-image-from-base-str) which includes the Debezium MySQL connector and its dependencies.

First download and extract the Debezium MySQL connector archive
```shell
curl https://repo1.maven.org/maven2/io/debezium/debezium-connector-mysql/1.0.0.Final/debezium-connector-mysql-1.0.0.Final-plugin.tar.gz \
| tar xvz
```

Prepare a `Dockerfile` which adds those connector files to the Strimzi Kafka Connect image

```shell
cat <<EOF >Dockerfile
FROM strimzi/kafka:0.16.1-kafka-2.4.0
USER root:root
RUN mkdir -p /opt/kafka/plugins/debezium
COPY ./debezium-connector-mysql/ /opt/kafka/plugins/debezium/
USER 1001
EOF
```

Then build the image from that `Dockerfile` and push it to dockerhub.

```shell
# You can use your own dockerhub organization
export DOCKER_ORG=tjbentley
docker build . -t ${DOCKER_ORG}/connect-debezium
docker push ${DOCKER_ORG}/connect-debezium
```

# Secure the database credentials

To make this a bit more realistic we're going to use Kafka's `config.providers` mechanism to avoid having to pass secret information over Kafka Connect REST interface (which uses unencrypted HTTP).
We'll to use a Kubernetes `Secret` called `my-sql-credentials` to store the database credentials. 
This will be mounted as a secret volume within the connect pods.
We can then configure the connector with the path to this file. 

Let's create the secret:

```shell
cat <<EOF > debezium-mysql-credentials.properties
mysql_username: debezium
mysql_password: dbz
EOF
kubectl -n kafka create secret generic my-sql-credentials \
  --from-file=debezium-mysql-credentials.properties
rm debezium-mysql-credentials.properties

```

# Create the Connect cluster

Now we can create a `KafkaConnect` cluster in Kubernetes:

```shell
cat <<EOF | kubectl -n kafka apply -f -
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaConnect
metadata:
  name: my-connect-cluster
  annotations:
  # use-connector-resources configures this KafkaConnect
  # to use KafkaConnector resources to avoid
  # needing to call the Connect REST API directly
    strimzi.io/use-connector-resources: "true"
spec:
  image: ${DOCKER_ORG}/connect-debezium
  replicas: 1
  bootstrapServers: my-cluster-kafka-bootstrap:9093
  tls:
    trustedCertificates:
      - secretName: my-cluster-cluster-ca-cert
        certificate: ca.crt
  config:
    config.storage.replication.factor: 1
    offset.storage.replication.factor: 1
    status.storage.replication.factor: 1
    config.providers: file
    config.providers.file.class: org.apache.kafka.common.config.provider.FileConfigProvider
  externalConfiguration:
    volumes:
      - name: connector-config
        secret:
          secretName: my-sql-credentials

EOF
```

It's worth pointing out a couple of things about the above resource:

* In the `metadata.annotations` the `strimzi.io/use-connector-resources: "true"` annotation tells the cluster operator that `KafkaConnector` resources will be used to configure connectors within this Kafka Connect cluster.
* The `spec.image` is the image we created with `docker`.
* In the `config` we're using replication factor 1 because we created a single-broker Kafka cluster.
* In the `externalConfiguration` we're referencing the secret we just created.


# Create the connector

The last piece is to create the `KafkaConnector` resource configured to connect to our "inventory" database in MySQL.

Here's what the `KafkaConnector` resource looks like:


```shell
cat | kubectl -n kafka apply -f - << 'EOF'
apiVersion: "kafka.strimzi.io/v1alpha1"
kind: "KafkaConnector"
metadata:
  name: "inventory-connector"
  labels:
    strimzi.io/cluster: my-connect-cluster
spec:
  class: io.debezium.connector.mysql.MySqlConnector
  tasksMax: 1
  config:
    database.hostname: 192.168.99.1
    database.port: "3306"
    database.user: "${file:/opt/kafka/external-configuration/connector-config/debezium-mysql-credentials.properties:mysql_username}"
    database.password: "${file:/opt/kafka/external-configuration/connector-config/debezium-mysql-credentials.properties:mysql_password}"
    database.server.id: "184054"
    database.server.name: "dbserver1"
    database.whitelist: "inventory"
    database.history.kafka.bootstrap.servers: "my-cluster-kafka-bootstrap:9092"
    database.history.kafka.topic: "schema-changes.inventory"
    include.schema.changes: "true" 
EOF
```

In `metadata.labels`, `strimzi.io/cluster` names the `KafkaConnect` cluster which this connector will be created in.

The `spec.class` names the Debezium MySQL connector and `spec.tasksMax` must be 1 because that's all this connector ever uses.

The `spec.config` object contains the rest of the connector configuration.
The [Debezium documentation](https://debezium.io/documentation/reference/0.10/connectors/mysql.html#connector-properties) explains the available properties, but it's worth calling out some specifically:
* I'm using `database.hostname: 192.168.99.1` as IP address for connecting to MySQL because I'm using `minikube` with the virtualbox VM driver
  If you're using a different VM driver with `minikube` you might need a different IP address.
* The `database.port: "3306"` works because of the `-p 3306:3306` argument we used when we started up the MySQL server.
* The `${file:...}` used for the `database.user` and `database.password` is a placeholder which gets replaced with the referenced property from the given file in the secret we created. 
* The `database.whitelist: "inventory"` basically tells Debezium to only watch the `inventory` database.
* The `database.history.kafka.topic: "schema-changes.inventory"` configured Debezium to use the `schema-changes.inventory` topic to store the database schema history.


A while after you've created this connector you can have a look at its `status`, using `kubectl -n kafka get kctr inventory-connector -o yaml`:

```yaml
#...
status:
  conditions:
  - lastTransitionTime: "2020-01-24T14:28:32.406Z"
    status: "True"
    type: Ready
  connectorStatus:
    connector:
      state: RUNNING
      worker_id: 172.17.0.9:8083
    name: inventory-connector
    tasks:
    - id: 0
      state: RUNNING
      worker_id: 172.17.0.9:8083
    type: source
  observedGeneration: 3

```

This tells us that the connector is running within the `KafkaConnect` cluster we created in the last step.


To summarise, we've now the complete picture with the connector talking to MySQL:

<pre style="line-height: 1.2 !important;"><code>
┌────────────────────────────────┐         ┌────────────────────────────────┐
│ minikube, namespace: kafka     │         │ docker                         │
│                                │         │                                │
│ Kafka                          │     ┏━━━┿━▶ MySQL                        │
│  name: my-cluster              │     ┃   │                                │
│                                │     ┃   └────────────────────────────────┘
│ KafkaConnect                   │     ┃
│  name: my-connect              │     ┃
│                                │     ┃
│ KafkaConnector                 │     ┃
│  name: inventory-connector ◀━━━┿━━━━━┛
│                                │
└────────────────────────────────┘
</code></pre>

> OK, I admit it: I was lying about the ASCII art being awesome.


# Showtime!

If you list the topics, for example using `kubectl -n kafka exec my-cluster-kafka-0 -c kafka -i -t -- bin/kafka-topics.sh --bootstrap-server localhost:9092 --list` you should see:

```
__consumer_offsets
connect-cluster-configs
connect-cluster-offsets
connect-cluster-status
dbserver1
dbserver1.inventory.addresses
dbserver1.inventory.customers
dbserver1.inventory.geom
dbserver1.inventory.orders
dbserver1.inventory.products
dbserver1.inventory.products_on_hand
schema-changes.inventory
```

The `connect-cluster-*` topics are the usual internal Kafka Connect topics.
Debezium has created a topic for the server itself (`dbserver1`), and one for each table within the `inventory` database.

Let's start consuming from one of those change topics:

```shell
kubectl -n kafka exec my-cluster-kafka-0 -c kafka -i -t -- \
  bin/kafka-console-consumer.sh \
    --bootstrap-server localhost:9092 \
    --topic dbserver1.inventory.customers 
```

This will block waiting for records/messages. To produce those messages we have to make some changes in the database. 
So back in the terminal window we left open with the MySQL command line client running we can make some changes to the data. First let's see the existing customers:

```
mysql> SELECT * FROM customers;
+------+------------+-----------+-----------------------+
| id   | first_name | last_name | email                 |
+------+------------+-----------+-----------------------+
| 1001 | Sally      | Thomas    | sally.thomas@acme.com |
| 1002 | George     | Bailey    | gbailey@foobar.com    |
| 1003 | Edward     | Walker    | ed@walker.com         |
| 1004 | Anne       | Kretchmar | annek@noanswer.org    |
+------+------------+-----------+-----------------------+
4 rows in set (0.00 sec)
```

Now let's change the `first_name` of the last customer:

```
mysql> UPDATE customers SET first_name='Anne Marie' WHERE id=1004;
```

Switching terminal window again we should be able to see this name change event in the `dbserver1.inventory.customers` topic:

```
{"schema":{"type":"struct","fields":[{"type":"struct","fields":[{"type":"int32","optional":false,"field":"id"},{"type":"string","optional":false,"field":"first_name"},{"type":"string","optional":false,"field":"last_name"},{"type":"string","optional":false,"field":"email"}],"optional":true,"name":"dbserver1.inventory.customers.Value","field":"before"},{"type":"struct","fields":[{"type":"int32","optional":false,"field":"id"},{"type":"string","optional":false,"field":"first_name"},{"type":"string","optional":false,"field":"last_name"},{"type":"string","optional":false,"field":"email"}],"optional":true,"name":"dbserver1.inventory.customers.Value","field":"after"},{"type":"struct","fields":[{"type":"string","optional":false,"field":"version"},{"type":"string","optional":false,"field":"connector"},{"type":"string","optional":false,"field":"name"},{"type":"int64","optional":false,"field":"ts_ms"},{"type":"string","optional":true,"name":"io.debezium.data.Enum","version":1,"parameters":{"allowed":"true,last,false"},"default":"false","field":"snapshot"},{"type":"string","optional":false,"field":"db"},{"type":"string","optional":true,"field":"table"},{"type":"int64","optional":false,"field":"server_id"},{"type":"string","optional":true,"field":"gtid"},{"type":"string","optional":false,"field":"file"},{"type":"int64","optional":false,"field":"pos"},{"type":"int32","optional":false,"field":"row"},{"type":"int64","optional":true,"field":"thread"},{"type":"string","optional":true,"field":"query"}],"optional":false,"name":"io.debezium.connector.mysql.Source","field":"source"},{"type":"string","optional":false,"field":"op"},{"type":"int64","optional":true,"field":"ts_ms"}],"optional":false,"name":"dbserver1.inventory.customers.Envelope"},"payload":{"before":{"id":1004,"first_name":"Anne","last_name":"Kretchmar","email":"annek@noanswer.org"},"after":{"id":1004,"first_name":"Anne Mary","last_name":"Kretchmar","email":"annek@noanswer.org"},"source":{"version":"0.10.0.Final","connector":"mysql","name":"dbserver1","ts_ms":1574090237000,"snapshot":"false","db":"inventory","table":"customers","server_id":223344,"gtid":null,"file":"mysql-bin.000003","pos":4311,"row":0,"thread":3,"query":null},"op":"u","ts_ms":1574090237089}}
```

which is rather a lot of JSON, but if we reformat it (e.g. using copying, paste and `jq`) we see:

```json
{
  "schema": {
    "type": "struct",
    "fields": [
      {
        "type": "struct",
        "fields": [
          {
            "type": "int32",
            "optional": false,
            "field": "id"
          },
          {
            "type": "string",
            "optional": false,
            "field": "first_name"
          },
          {
            "type": "string",
            "optional": false,
            "field": "last_name"
          },
          {
            "type": "string",
            "optional": false,
            "field": "email"
          }
        ],
        "optional": true,
        "name": "dbserver1.inventory.customers.Value",
        "field": "before"
      },
      {
        "type": "struct",
        "fields": [
          {
            "type": "int32",
            "optional": false,
            "field": "id"
          },
          {
            "type": "string",
            "optional": false,
            "field": "first_name"
          },
          {
            "type": "string",
            "optional": false,
            "field": "last_name"
          },
          {
            "type": "string",
            "optional": false,
            "field": "email"
          }
        ],
        "optional": true,
        "name": "dbserver1.inventory.customers.Value",
        "field": "after"
      },
      {
        "type": "struct",
        "fields": [
          {
            "type": "string",
            "optional": false,
            "field": "version"
          },
          {
            "type": "string",
            "optional": false,
            "field": "connector"
          },
          {
            "type": "string",
            "optional": false,
            "field": "name"
          },
          {
            "type": "int64",
            "optional": false,
            "field": "ts_ms"
          },
          {
            "type": "string",
            "optional": true,
            "name": "io.debezium.data.Enum",
            "version": 1,
            "parameters": {
              "allowed": "true,last,false"
            },
            "default": "false",
            "field": "snapshot"
          },
          {
            "type": "string",
            "optional": false,
            "field": "db"
          },
          {
            "type": "string",
            "optional": true,
            "field": "table"
          },
          {
            "type": "int64",
            "optional": false,
            "field": "server_id"
          },
          {
            "type": "string",
            "optional": true,
            "field": "gtid"
          },
          {
            "type": "string",
            "optional": false,
            "field": "file"
          },
          {
            "type": "int64",
            "optional": false,
            "field": "pos"
          },
          {
            "type": "int32",
            "optional": false,
            "field": "row"
          },
          {
            "type": "int64",
            "optional": true,
            "field": "thread"
          },
          {
            "type": "string",
            "optional": true,
            "field": "query"
          }
        ],
        "optional": false,
        "name": "io.debezium.connector.mysql.Source",
        "field": "source"
      },
      {
        "type": "string",
        "optional": false,
        "field": "op"
      },
      {
        "type": "int64",
        "optional": true,
        "field": "ts_ms"
      }
    ],
    "optional": false,
    "name": "dbserver1.inventory.customers.Envelope"
  },
  "payload": {
    "before": {
      "id": 1004,
      "first_name": "Anne",
      "last_name": "Kretchmar",
      "email": "annek@noanswer.org"
    },
    "after": {
      "id": 1004,
      "first_name": "Anne Mary",
      "last_name": "Kretchmar",
      "email": "annek@noanswer.org"
    },
    "source": {
      "version": "1.0.0.Final",
      "connector": "mysql",
      "name": "dbserver1",
      "ts_ms": 1574090237000,
      "snapshot": "false",
      "db": "inventory",
      "table": "customers",
      "server_id": 223344,
      "gtid": null,
      "file": "mysql-bin.000003",
      "pos": 4311,
      "row": 0,
      "thread": 3,
      "query": null
    },
    "op": "u",
    "ts_ms": 1574090237089
  }
}
```

The `schema` object is describing the schema of the actual event payload.

What's more interesting for this post is the `payload` itself. Working backwards we have:
* `ts_ms` is the timestamp of when the change happened
* `op` tells us this was an `u`pdate (an insert would be `c` and a delete would be `d`) 
* the `source` which tells us exactly which table of which database in which server got changed.
* `before` and `after` are pretty self-explanatory, describing the row before and after the update.

You can of course experiment with inserting and deleting rows in different tables (remember, there's a topic for each table).

But what about that `dbserver1` topic which I glossed over? If we look at the messages in there 
(using `kubectl -n kafka exec my-cluster-kafka-0 -c kafka -i -t -- bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic dbserver1 --from-beginning`) 
we can see records representing the DDL which was used (when the docker image was created) to create the database.
For example:

```json
{
  "schema": {
    "type": "struct",
    "fields": [
      {
        "type": "struct",
        "fields": [
          {
            "type": "string",
            "optional": false,
            "field": "version"
          },
          {
            "type": "string",
            "optional": false,
            "field": "connector"
          },
          {
            "type": "string",
            "optional": false,
            "field": "name"
          },
          {
            "type": "int64",
            "optional": false,
            "field": "ts_ms"
          },
          {
            "type": "string",
            "optional": true,
            "name": "io.debezium.data.Enum",
            "version": 1,
            "parameters": {
              "allowed": "true,last,false"
            },
            "default": "false",
            "field": "snapshot"
          },
          {
            "type": "string",
            "optional": false,
            "field": "db"
          },
          {
            "type": "string",
            "optional": true,
            "field": "table"
          },
          {
            "type": "int64",
            "optional": false,
            "field": "server_id"
          },
          {
            "type": "string",
            "optional": true,
            "field": "gtid"
          },
          {
            "type": "string",
            "optional": false,
            "field": "file"
          },
          {
            "type": "int64",
            "optional": false,
            "field": "pos"
          },
          {
            "type": "int32",
            "optional": false,
            "field": "row"
          },
          {
            "type": "int64",
            "optional": true,
            "field": "thread"
          },
          {
            "type": "string",
            "optional": true,
            "field": "query"
          }
        ],
        "optional": false,
        "name": "io.debezium.connector.mysql.Source",
        "field": "source"
      },
      {
        "type": "string",
        "optional": false,
        "field": "databaseName"
      },
      {
        "type": "string",
        "optional": false,
        "field": "ddl"
      }
    ],
    "optional": false,
    "name": "io.debezium.connector.mysql.SchemaChangeValue"
  },
  "payload": {
    "source": {
      "version": "1.0.0.Final",
      "connector": "mysql",
      "name": "dbserver1",
      "ts_ms": 0,
      "snapshot": "true",
      "db": "inventory",
      "table": "products_on_hand",
      "server_id": 0,
      "gtid": null,
      "file": "mysql-bin.000003",
      "pos": 2324,
      "row": 0,
      "thread": null,
      "query": null
    },
    "databaseName": "inventory",
    "ddl": "CREATE TABLE `products_on_hand` (\n  `product_id` int(11) NOT NULL,\n  `quantity` int(11) NOT NULL,\n  PRIMARY KEY (`product_id`),\n  CONSTRAINT `products_on_hand_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=latin1"
  }
}
```

Again we have a `schema` and `payload`. This time the `payload` has:

* `source`, like before,
* `databaseName`, which tells us which database this record is for 
* the `ddl` string tells us how the `products_on_hand` table was created.

# Conclusion

In this post we've learned that Strimzi now supports a `KafkaConnector` custom resource which you can use to define connectors.
We've demonstrated this generic functionality using the Debezium connector as an example.
By creating a `KafkaConnector` resource, linked to our `KafkaConnect` cluster via the `strimzi.io/cluster` label, we were able to observe changes made in a MySQL database as records in a Kafka topic.
And finally, we've been left with a feeling of disappointment about the unfulfilled promise of awesome ASCII art.



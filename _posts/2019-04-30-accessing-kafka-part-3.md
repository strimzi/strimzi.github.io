---
layout: post
title:  "Accessing Kafka: Part 3 - OpenShift Routes"
date: 2019-04-30
author: jakub_scholz
---

In the third part of this blog post series we will look at exposing Kafka using OpenShift Routes.
This post will explain how routes work and how can they be used with Kafka.
Routes are available only on OpenShift.
But if you are a Kubernetes user, don't be sad, one of the next part will be about using Kubernetes Ingress which is similar to OpenShift routes.

<!--more-->

_This post is part of a bigger series about different ways to access a Kafka cluster powered by Strimzi.
The other parts published so far are:_

* _[Part 1 - Introduction](https://strimzi.io/2019/04/17/accessing-kafka-part-1.html)_
* _[Part 2 - Node Ports](https://strimzi.io/2019/04/23/accessing-kafka-part-2.html)_
* _Part 3 - OpenShift Routes (this post)_

# OpenShift Routes

Routes are OpenShift concept for exposing services to the outside of the OpenShift platform.
Routes handle both data routing as well as DNS resolution.
DNS resolution is usually handled using wildcard DNS entries.
That allows OpenShift to assign each route its own DNS which is based on the wildcard entry.
Users do not have to anything special to handle the DNS records.
Don't worry, when you don't own any domains where you can setup the wildcard entires, it can use services such as [nip.ip](https://nip.io/) for the DNS routing.
Data routing is done using the [HAProxy](https://www.haproxy.org) load balancer which serves as the router behind the routes.

The main use-case of the is HTTP(S) routing.
The routes are able to do path based routing of HTTP and HTTPS (with TLS termination) traffic.
In this mode, the HTTP requests will be routed to different services based on the request path.
However, since Kafka protocol is not based on HTTP, the HTTP features are not very useful for Strimzi and Kafka brokers.

But luckily the routes can be also used for TLS passthrough.
In this mode, it uses TLS SNI to determine the service to which the traffic should be routed and passes the TLS connection to the service (and eventually to the pod backing the service) without decoding it.
This mode is what Strimzi is using for exposing Kafka.

If you want to learn more about OpenShift Routes, check the [OpenShift documentation](https://docs.openshift.com/container-platform/3.11/architecture/networking/routes.html).

# Exposing Kafka using OpenShift Routes

Exposing Kafka using OpenShift Routes is probably the easiest of all the available options.
All you need to do is to configure it in the Kafka custom resource.

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    listeners:
      # ...
      external:
        type: route
    # ...
```

And Strimzi and OpenShift will take care of the rest.
To provide access to the individual brokers, we use the same tricks as we use with node ports and which were already described in the [previous blog post](https://strimzi.io/2019/04/23/accessing-kafka-part-2.html).
We create a dedicated service for each of the brokers.
These will be used to address the individual brokers directly.
Apart from that we will also use one service for the bootstrapping of the client.
This service would round-robin between all Kafka brokers.

But unlike when using node ports, these services will be only regular Kubernetes service of the `clusterIP` type.
Instead, the Strimzi Kafka operator will also create a `Route` resource for each of these services.
That will expose them using the HAProxy router.
The DNS addresses assigned to these routes will be used by Strimzi to configure the advertised addresses in the different Kafka brokers.

![Accessing Kafka using per-pod routes]({{ "/assets/2019-04-30-per-pod-routes.png" }})

Kafka clients will connect to the bootstrap route which will route them through the bootstrap service to one of the brokers.
From this broker, they will get the metadata which will contain the DNS names of the routes.
The Kafka client will use these addresses to connect to the routes dedicated to the specific broker.
And the router will again route it through the corresponding service into the correct Kafka broker.

As explained in the previous section, the routers main use-case is routing of HTTP(S) traffic.
Therefore it is always listening on the ports 80 and 443.
Since Strimzi is using the TLS passthrough functionality, it means that:
* The port will be always 443 as the port used for HTTPS.
* The traffic will **always use TLS encryption**.

Getting the address where to connect with your client is easy.
As mentioned above, the port will be always 443.
And you can find the host in the status of the `Route` resource (replace `my-cluster` with the name of your cluster):

```
oc get routes my-cluster-kafka-bootstrap -o=jsonpath='{.status.ingress[0].host}{"\n"}'
```

By default, the DNS name of the route will be based on the name of the service it points to and on the name of the OpenShift project.
So for example for my Kafka cluster named `my-cluster` running in project named `myproject`, the default DNS name will be something like `my-cluster-kafka-bootstrap-myproject.mydomain.io`.

Since it will always use TLS, you will always have to configure the TLS also in your Kafka clients.
This includes getting the TLS certificate from the broker and configuring it in the client.
You can use following commands to get the CA certificate used by the Kafka brokers and import it into Java Keystore file which can be used with Java applications (replace `my-cluster` with the name of your cluster):

```
oc extract secret/my-cluster-cluster-ca-cert --keys=ca.crt --to=- > ca.crt
keytool -import -trustcacerts -alias root -file ca.crt -keystore truststore.jks -storepass password -noprompt
```

With the certificate and address, you can connect to the Kafka cluster.
The following example uses the `kafka-console-producer.sh` utility which is part of Apache Kafka:

```
bin/kafka-console-producer.sh --broker-list <route-address>:443 --producer-property security.protocol=SSL --producer-property ssl.truststore.password=password --producer-property ssl.truststore.location=./truststore.jks --topic <your-topic>
```

For more details, see the [Strimzi documentation](https://strimzi.io/docs/latest/full.html#proc-accessing-kafka-using-routes-deployment-configuration-kafka).











# Customizations

Strimzi aims to make node ports work out of the box.
But there are several options which you can use to customize the Kafka cluster and its node port services.

## Pre-configured node port numbers

By default, the node port numbers are generated / assigned by the Kubernetes controllers.
That means that every time you delete your Kafka cluster and deploy a new one, a new set of node ports will be assigned to the Kubernetes services created by Strimzi.
So after every redeployment you have to reconfigure all your applications using the node ports with the new node port of the bootstrap service.

Strimzi allows you to customize the node ports in the `Kafka` custom resource:

```yaml
# ...
listeners:
  external:
    type: nodeport
    tls: true
    authentication:
      type: tls
    overrides:
      bootstrap:
        nodePort: 32100
      brokers:
      - broker: 0
        nodePort: 32000
      - broker: 1
        nodePort: 32001
      - broker: 2
        nodePort: 32002
# ...
```

The example above requests node port `32100` for the bootstrap service and ports `32000`, `32001` and `32002` for the per-broker services.
This allows you to re-deploy your cluster without changing the node ports numbers in all your applications.

However, Strimzi doesn't do any validation of the requested port numbers.
So you have to make sure that they are:

* within the range assigned for node ports in the configuration of your Kubernetes cluster
* not used by any other service.

You do not have to configure all the node ports.
You can decide to configure only some of them - for example only the one for the external bootstrap service.

## Configuring advertised hosts and ports

Strimzi also allows you to customize the advertised hostname and port which will be used in the configuration of the Kafka pods:

```yaml
# ...
listeners:
  external:
    type: nodeport
    authentication:
      type: tls
    overrides:
      brokers:
      - broker: 0
        advertisedHost: example.hostname.0
        advertisedPort: 12340
      - broker: 1
        advertisedHost: example.hostname.1
        advertisedPort: 12341
      - broker: 2
        advertisedHost: example.hostname.2
        advertisedPort: 12342
# ...
```

The `advertisedHost` field can contain either DNS name or an IP address.
You can of course also decide to customize just one of these.

Changing the advertised port will only change the advertised port in the Kafka broker configuration.
It will have no impact on the node port which is assigned by Kubernetes.
To configure the node port numbers used by the Kubernetes services, use the `nodePort` option described above.

Overriding the advertised hosts is something we already used in the troubleshooting section above when the node address provided by the Kubernetes API was not the correct one.
But it can be useful also in other situations.

For example when your network does some network address translation:

![Using host overrides with network address translation]({{ "/assets/2019-04-23-host-override.png" }})

Another example might be when you don't want the clients to connect directly to the nodes where the Kafka pods are running.
You can have only selected Kubernetes nodes exposed to the clients and use the `advertisedHost` option to configure the Kafka brokers to use these nodes.

![Using overrides to route traffic over infra-nodes]({{ "/assets/2019-04-23-infra-node.png" }})

# Pros and cons

Exposing your Kafka cluster to the outside using node ports can give you a lot of flexibility.
It is also able to deliver very good performance.
Compared to other solutions such as load-balancers, routes or ingress there is no middleman to be a bottleneck or add latency.
Your client connections will go to your Kafka broker in the most direct way possible.

But there is also a price you have to pay for this.
Node ports are a very low level solution.
Often you will run into problems with the detection of the advertised addresses as described in the sections above.
Another problem might be that node ports expect you to expose your Kubernetes nodes to the clients.
And that is often seen as security risk by the administrators.

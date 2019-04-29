---
layout: post
title:  "Accessing Kafka: Part 3 - OpenShift Routes"
date: 2019-04-30
author: jakub_scholz
---

In the third part of this blog post series we will look at exposing Kafka using OpenShift Routes.
This post will explain how routes work and how they can be used with Kafka.
Routes are available only on OpenShift.
But if you are a Kubernetes user, don't be sad, one of the next parts will be about using Kubernetes Ingress which is similar to OpenShift routes.

<!--more-->

_This post is part of a bigger series about different ways to access a Kafka cluster powered by Strimzi.
The other parts published so far are:_

* _[Part 1 - Introduction](https://strimzi.io/2019/04/17/accessing-kafka-part-1.html)_
* _[Part 2 - Node Ports](https://strimzi.io/2019/04/23/accessing-kafka-part-2.html)_
* _Part 3 - OpenShift Routes (this post)_

# OpenShift Routes

Routes are an OpenShift concept for exposing services to the outside of the OpenShift platform.
Routes handle both data routing as well as DNS resolution.
DNS resolution is usually handled using [wildcard DNS entries](https://en.wikipedia.org/wiki/Wildcard_DNS_record).
That allows OpenShift to assign each route its own DNS name which is based on the wildcard entry.
Users do not have to do anything special to handle the DNS records.
But don't worry, when you don't own any domains where you can setup the wildcard entires, it can use services such as [nip.ip](https://nip.io/) for the wildcard DNS routing.
Data routing is done using the [HAProxy](https://www.haproxy.org) load balancer which serves as the router behind the domain names.

The main use-case of the router is HTTP(S) routing.
The routes are able to do path based routing of HTTP and HTTPS (with TLS termination) traffic.
In this mode, the HTTP requests will be routed to different services based on the request path.
However, since the Kafka protocol is not based on HTTP, the HTTP features are not very useful for Strimzi and Kafka brokers.

But luckily the routes can be also used for TLS passthrough.
In this mode, it uses TLS [SNI](https://en.wikipedia.org/wiki/Server_Name_Indication) to determine the service to which the traffic should be routed and passes the TLS connection to the service (and eventually to the pod backing the service) without decoding it.
This mode is what Strimzi uses to expose Kafka.

If you want to learn more about OpenShift Routes, check the [OpenShift documentation](https://docs.openshift.com/container-platform/3.11/architecture/networking/routes.html).

# Exposing Kafka using OpenShift Routes

Exposing Kafka using OpenShift Routes is probably the easiest of all the available listener types.
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

And Strimzi Kafka Operator and OpenShift will take care of the rest.
To provide access to the individual brokers, we use the same tricks as we use with node ports and which were already described in the [previous blog post](https://strimzi.io/2019/04/23/accessing-kafka-part-2.html).
We create a dedicated service for each of the brokers.
These will be used to address the individual brokers directly.
Apart from that we will also use one service for the bootstrapping of the clients.
This service would round-robin between all available Kafka brokers.

But unlike when using node ports, these services will be only regular Kubernetes services of the `clusterIP` type.
The Strimzi Kafka operator will also create a `Route` resource for each of these services.
That will expose them using the HAProxy router.
The DNS addresses assigned to these routes will be used by Strimzi to configure the advertised addresses in the different Kafka brokers.

![Accessing Kafka using per-pod routes]({{ "/assets/2019-04-30-per-pod-routes.png" }})

Kafka clients will connect to the bootstrap route which will route them through the bootstrap service to one of the brokers.
From this broker, they will get the metadata which will contain the DNS names of the per-broker routes.
The Kafka clients will use these addresses to connect to the routes dedicated to the specific broker.
And the router will again route it through the corresponding service to the right pod.

As explained in the previous section, the routers main use-case is routing of HTTP(S) traffic.
Therefore it is always listening on the ports 80 and 443.
Since Strimzi is using the TLS passthrough functionality, it means that:
* The port will always be 443 as the port used for HTTPS.
* The traffic will **always use TLS encryption**.

Getting the address to connect to with your client is easy.
As mentioned above, the port will always be 443.
This is often a cause of issues, when users try to connect to port 9094 instead of 443.
But 443 is always the correct port number with OpenShift Routes.
And you can find the host in the status of the `Route` resource (replace `my-cluster` with the name of your cluster):

```
oc get routes my-cluster-kafka-bootstrap -o=jsonpath='{.status.ingress[0].host}{"\n"}'
```

By default, the DNS name of the route will be based on the name of the service it points to and on the name of the OpenShift project.
So for example for my Kafka cluster named `my-cluster` running in project named `myproject`, the default DNS name will be `my-cluster-kafka-bootstrap-myproject.<router-domain>`.

Since it will always use TLS, you will always have to configure TLS in your Kafka clients.
This includes getting the TLS certificate from the broker and configuring it in the client.
You can use following commands to get the CA certificate used by the Kafka brokers and import it into Java keystore file which can be used with Java applications (replace `my-cluster` with the name of your cluster):

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

As explained in the previous section, by default the routes get automatically assigned DNS names based on the name of your cluster and namespace, but you can customize this and specify your own DNS names:

```yaml
# ...
listeners:
  external:
    type: route
    authentication:
      type: tls
    overrides:
      bootstrap:
        host: bootstrap.myrouter.com
      brokers:
      - broker: 0
        host: broker-0.myrouter.com
      - broker: 1
        host: broker-1.myrouter.com
      - broker: 2
        host: broker-2.myrouter.com
# ...
```

The customized names still need to match the DNS configuration of the OpenShift router.
But you can give them a friendlier name.
The custom DNS names (as well as the names automatically assigned to the routes) will be of course added to the TLS certificates and your Kafka clients can use TLS hostname verification.

# Pros and cons

Routes are only available on OpenShift.
So if you are using Kubernetes, this will be clearly a deal breaking disadvantage.
Another potential disadvantage is that routes always use TLS encryption.
You will always have to deal with the TLS certificates and encryption in your Kafka clients and applications.

You should also carefully consider performance.
The OpenShift HAProxy router will act as a middleman between your Kafka clients and brokers.
It can add latency and it can also become a performance bottleneck.
Applications using Kafka also often generate a lot of traffic - hundreds or even thousands megabytes per second.
You have to keep this in mind and make sure that the Kafka traffic will still leave some capacity for other applications using the router.
Luckily, the OpenShift Router is scalable and highly configurable so you can fine-tune its performance and if needed, you can even setup a separate instances of the router for the Kafka routes.

The main advantage of using OpenShift Routes is that they are so easy to get working.
Unlike the node ports discussed in the previous blog post, which are often tricky to configure and require a deeper knowledge of Kubernetes and the infrastructure, OpenShift routes work very reliably out of the box on any OpenShift installation.

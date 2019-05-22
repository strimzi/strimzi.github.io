---
layout: post
title:  "Accessing Kafka: Part 5 - Ingress"
date: 2019-05-23
author: jakub_scholz
---

In the fifth and last part of this blog post series we will look at exposing Kafka using Kubernetes Ingress.
This post will explain how to use Ingress controllers on Kubernetes, how Ingress compares with OpenShift Routes and how it can be used with Strimzi and Kafka.
Off-cluster access using Kubernetes Ingress is available only from Strimzi 0.12.0.

<!--more-->

_This post is part of a bigger series about different ways to access a Kafka cluster powered by Strimzi.
The other parts published so far are:_

* _[Part 1 - Introduction](https://strimzi.io/2019/04/17/accessing-kafka-part-1.html)_
* _[Part 2 - Node Ports](https://strimzi.io/2019/04/23/accessing-kafka-part-2.html)_
* _[Part 3 - OpenShift Routes](https://strimzi.io/2019/04/30/accessing-kafka-part-3.html)_
* _[Part 4 - Load Balancers](https://strimzi.io/2019/05/13/accessing-kafka-part-4.html)_
* _Part 5 - Ingress (this post)_

_This is the last post in the series._

## Kubernetes Ingress

Ingress is a Kubernetes API for managing external access to HTTP/HTTPS services which was added in Kubernetes 1.1.
Ingress is the Kubernetes counterpart to OpenShift Routes, which we discussed in [part 3](https://strimzi.io/2019/04/30/accessing-kafka-part-3.html).
It acts as a [Layer 7](https://en.wikipedia.org/wiki/OSI_model#Layer_7:_Application_Layer) load balancer for HTTP or HTTPS traffic.
The Ingress resources will define the rules for routing the traffic to different services and pods.
An Ingress controller takes care of the actual routing.
For more information about Ingress, check the [Kubernetes website](https://kubernetes.io/docs/concepts/services-networking/ingress/).

Ingress is a bit of a strange part of the Kubernetes API.
The Ingress API itself is part of every Kubernetes cluster,
but the Ingress controller which would do the routing is not part of core Kubernetes.
So while you will be able to create the Ingress resources, there might be nothing to actually route the traffic.

So for the Ingress resources to actually do something, you need to make sure an Ingress controller is installed.
There are many different Ingress controllers.
The Kubernetes project itself has two controllers: 
* [NGINX controller](https://github.com/kubernetes/ingress-nginx)
* [GCE controller](https://github.com/kubernetes/ingress-gce) for Google Cloud

But there are many additional controllers created and maintained by different communities and companies.
A list of different controllers can be found on the [Kubernetes website](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/).

Most of the controllers rely on a load balancer or node port service which will get the external traffic to the controller.
Once the traffic reaches the controller, the controller will route it based in the rules specified in the Ingress resource to the different services and pods.
The controller itself usually also runs as yet another application inside the Kubernetes cluster.

![Accessing applications using NGINX Ingress Controller]({{ "/assets/2019-05-23-ingress-controller.png" }})

Some of the controllers are tailored for a specific public cloud - for example the [AWS ALB Ingress Controller](https://github.com/kubernetes-sigs/aws-alb-ingress-controller) provisions the AWS Application Load Balancer to do the routing instead of doing it inside some pod in your Kubernetes cluster.

Ingress offers a lot of functionality for HTTP applications such as:
* TLS termination
* Redirecting from HTTP to HTTPS
* Routing based on HTTP request path

Some of the controllers such as the NGINX controller also offer TLS passthrough, which is a feature we use in Strimzi.

## Using Ingress in Strimzi

Ingress support in Strimzi has been added in Strimzi 0.12.0.
It uses TLS passthrough and it was tested with the [NGINX Ingress Controller](https://github.com/kubernetes/ingress-nginx).
Before using it, please make sure that the TLS passthrough is [enabled in the controller](https://kubernetes.github.io/ingress-nginx/user-guide/tls/#ssl-passthrough).

Ingress support in Strimzi 0.12.0 is _experimental_.
If you have any feedback to it or if you want to help to make it work with different Ingress controllers, get in touch with us through our [Slack, mailing list or GitHub](https://strimzi.io/contributing/).

Although some Ingress controllers also support working directly with TCP connections, TLS passthrough seems to be more widely supported.
Therefore we decided to prefer TLS passthrough in Strimzi.
That also means that when using Ingress, TLS encryption will always be enabled.

One of the main differences compared to OpenShift Routes is that for Ingress you have to specify the host address in your Kafka custom resource.
The Router in OpenShift will automatically assign a host address based on the route name and the project.
But in Ingress the host address has to be specified in the Ingress resource.
You also have to take care that DNS resolves the host address to the ingress controller.
Strimzi cannot generate it for you, because it does not know which DNS addresses are configured for the Ingress controller.

If you want to try it for example on Minikube or in other environments where you don't have any managed DNS service to add the hosts for the Kafka cluster, you can use one of the wildcard DNS services such as [nip.io](https://nip.io/) or [xip.io](http://xip.io/) and set it to point to the IP address of your Ingress controller.
For example `broker-0.<minikube-ip-address>.nip.io`.

![Kafka clients connecting through Ingress controller]({{ "/assets/2019-05-23-connecting-through-ingress" }})

The way Strimzi uses Ingress to expose Kafka should already be familiar to you from the previous blog posts.
We create one service as a bootstrap service and additional services for individual access to each of the Kafka brokers in your cluster.
For each of these services we will also create one Ingress resource with the corresponding TLS passthrough rule.

![Accessing Kafka using Ingress]({{ "/assets/2019-05-23-ingress-access.png" }})

When configuring Strimzi to use Ingress, you have to specify the type of the external listener as `ingress` and specify the ingress hosts used for the different brokers as well as for bootstrap in the `configuration` field:

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
        type: ingress
        configuration:
          bootstrap:
            host: bootstrap.192.168.64.46.nip.io
          brokers:
          - broker: 0
            host: broker-0.192.168.64.46.nip.io
          - broker: 1
            host: broker-1.192.168.64.46.nip.io
          - broker: 2
            host: broker-2.192.168.64.46.nip.io
    # ...
```

Using Ingress in your clients is very similar to OpenShift Routes.
Since it always uses TLS Encryption, you have to first download the server certificate (replace `my-cluster` with the name of your cluster):

```
kubectl get secret cluster-name-cluster-ca-cert -o jsonpath='{.data.ca\.crt}' | base64 -d > ca.crt
keytool -import -trustcacerts -alias root -file ca.crt -keystore truststore.jks -storepass password -noprompt
```

Once you have the TLS certificate, you can use the bootstrap host you specified in the Kafka custom resource and connect to the Kafka cluster.
Since Ingress uses TLS passthrough, you always have to connect on port `443`.
The following example uses the `kafka-console-producer.sh` utility which is part of Apache Kafka:

```
bin/kafka-console-producer.sh --broker-list <bootstrap-host>:443 --producer-property security.protocol=SSL --producer-property ssl.truststore.password=password --producer-property ssl.truststore.location=./truststore.jks --topic <your-topic>
```

For example:

```
bin/kafka-console-producer.sh --broker-list bootstrap.192.168.64.46.nip.io:443 --producer-property security.protocol=SSL --producer-property ssl.truststore.password=password --producer-property ssl.truststore.location=./truststore.jks --topic <your-topic>
```

For more details, see the [Strimzi documentation](https://strimzi.io/docs/master/full.html#proc-accessing-kafka-using-ingress-deployment-configuration-kafka).

## Customizations

### DNS annotations

Many users are using some additional tools such as [ExternalDNS](https://github.com/kubernetes-incubator/external-dns) to automatically manage DNS records for their load balancers.
External DNS uses annotations on `Ingress` resources to manage their DNS names.
It supports many different DNS services such as Amazon AWS Route53, Google Cloud DNS, Azure DNS etc.

Strimzi lets you assign these annotations through the `Kafka` custom resource using a field called `dnsAnnotations`.
Using the DNS annotations is simple:

```yaml
# ...
listeners:
  external:
    type: ingress
    configuration:
      bootstrap:
        host: kafka-bootstrap.mydomain.com
      brokers:
      - broker: 0
        host: kafka-broker-0.mydomain.com
      - broker: 1
        host: kafka-broker-1.mydomain.com
      - broker: 2
        host: kafka-broker-2.mydomain.com
    overrides:
      bootstrap:
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-bootstrap.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
      brokers:
      - broker: 0
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-0.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
      - broker: 1
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-1.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
      - broker: 2
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-2.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
# ...
```

Again, Strimzi lets you configure the annotations directly.
That gives you more freedom and hopefully makes this feature usable even when you use some other tool than External DNS.
It also lets you configure other options than just the DNS names, such as the time-to-live of the DNS records etc.

## Pros and cons

Kubernetes Ingress is not always easy to use because you have to install the Ingress controller and you have to configure the hosts.
It is also available only with TLS encryption because of the TLS passthrough functionality which Strimzi uses.
But it can offer an interesting option for clusters where node ports are not an option, for example for security reasons, and where using load balancers would be too expensive.

When using Strimzi Kafka operator with Ingress you always have to consider performance.
The ingress controller usually runs inside your cluster as yet another deployment and adds an additional step through which your data has to flow between your clients and the brokers.
You also need to scale it properly to ensure it will not be a bottleneck for your clients.

So Ingress might not be the best option when most of your applications using Kafka are outside of your Kubernetes cluster and you need to handle 10s or 100s MBs of throughput per second.
However, especially in situations when most of your applications are inside your cluster and only a minority outside and when the throughput you need is not so high, Ingress might be a convenient option.

The Ingress API and the Ingress controllers can usually be installed on OpenShift clusters as well.
But they do not offer any advantages over the OpenShift Routes.
So on OpenShift, you should prefer the OpenShift Routes instead.

## What's next?

This was, for now, the last post in this series about accessing Strimzi Kafka clusters.
In the 5 blog posts, we covered all the supported mechanisms that the Strimzi operator supports for accessing Kafka from both inside and outside of your Kubernetes or OpenShift cluster.
We will, of course, keep posting blog posts on other topics and if something about accessing Kafka changes in the future, we will add new blog posts to this series.

If you liked this series, star us on [GitHub](https://github.com/strimzi/strimzi-kafka-operator) and follow us on [Twitter](https://twitter.com/strimziio) to make sure you don't miss any of our future blog posts!

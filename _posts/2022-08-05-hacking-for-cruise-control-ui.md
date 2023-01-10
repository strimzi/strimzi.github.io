---
layout: post
title: "Hacking Strimzi for Cruise Control UI"
date: 2022-10-31
author: kyle_liberti
---

For some time now, Strimzi has used [Cruise Control](https://github.com/linkedin/cruise-control) for automated partition rebalancing and has offered Strimzi custom resources for safely configuring, deploying, and communicating with Cruise Control through the Strimzi Operator.
These custom resources provide great support for declaritive rebalancing.
That being said, rather than working with custom resources, you might prefer to interact with applications like Cruise Control through a graphical user interface.
LinkedIn provides such an interface with their [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) application which supports several Cruise Control operations like viewing Kafka cluster status and executing partition rebalances, all with just a couple button clicks.
Although Strimzi does not offer direct support for the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) it can still be run with and connected to a Strimzi-managed Cruise Control instance.

This post will walk through how to do so! 

**Warning**

Setting up the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) as described in this blog post requires disabling HTTP basic authentication for the Cruise Control REST API.
Without authentication, anybody with access to the Cruise Control API can use all the available endpoints and trigger administrative actions such as rebalancing partitions or decommissioning brokers.
If using the Cruise Control UI with a Strimzi-managed Kafka cluster, it is best to stick with using it solely for monitoring your cluster, not for operating on it.
That being said, use at your own risk!

![Cruise Control Frontend](/assets/images/posts/2019-08-08-cruise-control-frontend.png)


## Motivation

From time to time, we get a question about how to set up the Cruise Control UI with a Strimzi-managed Kafka cluster.
Maybe you want a pretty dashboard to view your cluster status.
Maybe you want to compare optimization proposals without having to open a text editor.
Maybe you are just a visual person.
Regardless of the reason, we want to provide some basic instructions for getting you started!

## Prerequisites

For starters we need a Strimzi-managed Kafka cluster with Cruise Control enabled.
Since Strimzi does not support creating custom Cruise Control API user roles we need to disable HTTP basic authentication settings.

We can do so by configuring Cruise Control within a `Kafka` resource like this:

``` 
# kafka-cruise-control.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  cruiseControl:
    config:
      webserver.security.enable: false
```

After configuring our Strimzi-managed Kafka cluster, we can deploy and connect the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) in one of two ways:

* METHOD ONE: Customizing the Cruise Control pod
* METHOD TWO: Creating a dedicated Cruise Control UI pod

## METHOD ONE: Customizing the Cruise Control pod

With our Strimzi-managed Kafka cluster deployed, we can create and deploy a custom Cruise Control image which includes the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) application inside of it.

![](/assets/images/posts/2022-10-31-hacking-for-cruise-control-ui-1.png)


### Inside the custom Cruise Control container

Here the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) will run alongside the Cruise Control application in the same container making its requests directly to the Cruise Control REST API.

![](/assets/images/posts/2022-10-31-hacking-for-cruise-control-ui-3.png)

### Building the Cruise Control UI container

We can base our custom Cruise Control image on the original Strimzi Kafka image and install the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) bits on top:

```Dockerfile
# The base image referenced here should point to the latest released Strimzi and a supported Kafka version.
# At the time of this post it is 0.32.0 and 3.3.1 respectively.
FROM quay.io/strimzi/kafka:0.32.0-kafka-3.3.1

ENV CC_UI_VERSION=0.4.0
ENV CC_UI_HOME=./cruise-control-ui/dist/

USER root

RUN mkdir -p ${CC_UI_HOME}

RUN curl -LO https://github.com/linkedin/cruise-control-ui/releases/download/v${CC_UI_VERSION}/cruise-control-ui-${CC_UI_VERSION}.tar.gz; \
    tar xvfz cruise-control-ui-${CC_UI_VERSION}.tar.gz -C ${CC_UI_HOME} --strip-components=2; \
    rm -f cruise-control-ui-${CC_UI_VERSION}.tar.gz*; \
    echo "dev,dev,/kafkacruisecontrol/" > "${CC_UI_HOME}"static/config.csv;

USER 1001
```
In the Dockerfile above, we unpack the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) files into the `/cruise-control-ui/dist/` directory.
This directory must match the value specified by the Cruise Control [Cruise Control](https://github.com/linkedin/cruise-control/wiki/Configurations) `webserver.ui.diskpath` configuration, the directory Cruise Control checks for UI files to serve.

Then building and pushing the image to a container registry:
```
# When building, tag the image with the name of a container registry
# that is accessible by the Kubernetes cluster.
# For example: quay.io/kliberti/cruise-control-with-ui:latest

# Build and tag the image
docker build . -t <registry>/<repository>/<cruise-control-with-ui-image-name>

# Push the image to that container registry
docker push <registry>/<repository>/<cruise-control-with-ui-image-name>
```

### Deploying the custom Cruise Control pod

We can deploy our custom Cruise Control pod in one of two ways:

* Deployment via `Kafka` custom resource
* Deployment via Strimzi Cluster Operator `Deployment`

#### Deployment via `Kafka` custom resource

This method will restart the Cruise Control instance associated with our `Kafka` resource.
We can edit our `Kafka` resource like this:

```
kubectl edit kafka <kafka-custom-resource-name>
```

Updating the `cruiseControl.image` section of the spec with the custom Cruise Control image:

```
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
   ...
spec:
   cruiseControl:
     image: <registry>/<repository>/<cruise-control-with-ui-image-name>
   ...
```

#### Deployment via Strimzi Cluster Operator `Deployment`

This method will restart the Cluster Operator pod and all Cruise Control instances.
We can edit our Strimzi Cluster Operator `Deployment` like this:

```
kubectl edit deployment strizi-cluster-operator
```

Updating the env section of the spec with the custom Cruise Control image:
```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: strimzi-cluster-operator
  ...
spec:
  ...
  template:
    ...
    spec:
      containers:
      - args:
        - /opt/strimzi/bin/cluster_operator_run.sh
        env:
          ...
        - name: STRIMZI_DEFAULT_CRUISE_CONTROL_IMAGE
          value: <registry>/<repository>/<cruise-control-with-ui-image-name>

```

After updating the deployment, the Cluster Operator will pull the new custom Cruise Control image and run it.

## METHOD TWO: Creating a dedicated Cruise Control UI pod

With our Strimzi-managed Kafka cluster deployed, we can now create a Cruise Control UI pod to run alongside it.

![](/assets/images/posts/2022-10-31-hacking-for-cruise-control-ui-2.png)

### Inside the Cruise Control UI container

Following the instructions on the [Cruise Control UI wiki](https://github.com/linkedin/cruise-control-ui/wiki/CCFE-(Dev-Mode)---Docker), we can configure an Nginx server as a reverse-proxy to forward Cruise Control UI requests to the Cruise Control REST API.

![](/assets/images/posts/2022-10-31-hacking-for-cruise-control-ui-4.png)

Here user requests from the Cruise Control UI are sent to the NGINX server where they are forwarded to the Cruise Control REST API.
The responses from the Cruise Control REST API are then returned to the NGINX server where they are then returned to the Cruise Control UI.

### Building the Cruise Control UI container

We can build our own Cruise Control image with a configured NGINX server and Cruise Control UI binaries following the instructions on the [Cruise Control UI wiki](https://github.com/linkedin/cruise-control-ui/wiki/CCFE-(Dev-Mode)---Docker), creating a Dockerfile like the following:

```Dockerfile
FROM nginx

ENV CRUISE_CONTROL_UI_VERSION=0.4.0
ENV NGINX_HOME=/usr/share/nginx/html/

RUN curl -LO https://github.com/linkedin/cruise-control-ui/releases/download/v${CRUISE_CONTROL_UI_VERSION}/cruise-control-ui-${CRUISE_CONTROL_UI_VERSION}.tar.gz; \
    tar xvfz cruise-control-ui-${CRUISE_CONTROL_UI_VERSION}.tar.gz -C ${NGINX_HOME} --strip-components=2; \
    rm -f cruise-control-ui-${CRUISE_CONTROL_UI_VERSION}.tar.gz*; \
    echo "dev,dev,/kafkacruisecontrol/" > "${NGINX_HOME}"static/config.csv;

EXPOSE 9090
```

Then building and pushing the image to a container registry:
```
# When building, tag the image with the name of a container registry
# that is accessible by the Kubernetes cluster.
# For example: quay.io/kliberti/cruise-control-with-ui:latest

# Build and tag the image
docker build . -t <registry>/<repository>/<cruise-control-ui-image-name>

# Push the image to that container registry
docker push <registry>/<repository>/<cruise-control-ui-image-name>
```

### Deploying the Cruise Control UI pod

Then we can create a `Deployment`, `ConfigMap`, `Service`, and `NetworkPolicy` for running the Cruise Control UI:

```yaml
# cruise-control-ui.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cruise-control-ui
  labels:
    app: cruise-control-ui
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cruise-control-ui
  template:
    metadata:
      labels:
        app: cruise-control-ui
    spec:
      containers:
      - name: cruise-control-ui
        image: <registry>/<repository>/<cruise-control-ui-image-name>>
        ports:
        - containerPort: 9090
        volumeMounts:
        - name: cruise-control-ui
          mountPath: /etc/nginx/conf.d
        - name: cluster-ca-certs
          mountPath: /etc/ssl/certs/
      volumes:
        - name: cruise-control-ui
          configMap:
            name: cruise-control-ui
        - name: api-auth-config
          secret:
            defaultMode: 292
            secretName: my-cluster-cruise-control-api
        - name: cluster-ca-certs
          secret:
            defaultMode: 292
            secretName: my-cluster-cruise-control-certs
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cruise-control-ui
  labels:
    app: cruise-control-ui
data:
  default.conf: |2+
        server {
        listen 9090 ssl;
        server_name localhost; 
        ssl_certificate     /etc/ssl/certs/cruise-control.crt;
        ssl_certificate_key /etc/ssl/certs/cruise-control.key;
       
        location / {
            root   /usr/share/nginx/html;
            index  index.html index.htm;
        }

        location /kafkacruisecontrol/ {
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_buffering off;
            proxy_pass https://my-cluster-cruise-control:9090/kafkacruisecontrol/;
            proxy_ssl_verify              off;
        }
        
        error_page   500 502 503 504  /50x.html;
        location = /50x.html {
            root   /usr/share/nginx/html;
        }
        }
---
apiVersion: v1
kind: Service
metadata:
  name: cruise-control-ui
  labels:
    app: cruise-control-ui
spec:
  selector:
    app: cruise-control-ui
  ports:
    - protocol: TCP
      port: 9090
      targetPort: 9090
```

Then run it:
```
kubectl apply -f cruise-control-ui.yaml -n <namespace>
```

## Using Cruise Control Front End

After deployment, the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) application will be accessible via a Cruise Control `service`.

If running the cluster locally with [minikube](https://github.com/kubernetes/minikube), you can port-forward the appropriate Cruise Control `service` to access it locally:

```
# METHOD ONE
kubectl port-forward svc/my-cluster-cruise-control 9090:9090

# METHOD TWO
kubectl port-forward svc/cruise-control-ui 9090:9090
```

Then navigate to [https://127.0.0.1:9090](https://127.0.0.1:9090) in your browser

![Cruise Control Frontend](/assets/images/posts/2019-08-08-cruise-control-frontend.png)

## Conclusion

Now we have a graphical user interface for Cruise Control running alongside and connected to a Strimzi-managed Kafka cluster. 
This UI is great for monitoring your Kafka cluster and getting more insight on the data and operations Cruise Control has to offer!
In a future version, the Strimzi community hopes to add the option for creating custom Cruise Control API users.
This would remove the requirement for the Cruise Control API security settings to be disabled for applications like the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) to work with Strimzi. Until then, hack away!

# Strimzi website

This repository contains the [Strimzi website](https://strimzi.io).

## Prerequisites

[Ruby](https://www.ruby-lang.org/en/) and [Rubygems](https://rubygems.org/) are needed in order to build the web site.

Install [bundler](https://bundler.io/)

    gem install bundler

## Build

In order to build and serve the web site locally, run :

    bundle install
    bundle exec jekyll serve

When running, the website is accessible at `localhost:4000`.

## Build using a container

To avoid needing to install Ruby, you can build and run the web site locally inside a container.
Run the following command:

    docker run --rm -v ${PWD}:/srv/jekyll -p 4000:4000 -it jekyll/jekyll jekyll serve

The build can take several minutes to complete.
When it's done, you'll see the message "Server running...".

**Note:** If you see the error `require': cannot load such file -- webrick (LoadError)`, add the following to the `Gemfile`:

    gem "webrick"

If you make this change, be sure not to check it in.

## Blog posts

We try to use the following process for blog posts:

1. You should start by [asking us](https://strimzi.io/join-us/#ask-for-help-and-help-others) whether your proposed subject is a good fit for the strimzi.io blog.
   The aim of this step is to prevent you wasting your time writing a post which isn't going to interest Strimzi users.
   If your proposal is not perfect from the off, we might suggest ways to make it more relevent to our audience.
   Even if we don't think it will be relevant we might be able to recommend a better site for your proposed content.
   
2. You write your post and open a PR.
   To start a new blog post, just create a new file in the `_posts` subdirectory and name it `<date>-<title>.md`. 
   For the date, you can use the current date (after your blog post is reviewed and approved, we will change it to the actual publishing date when merging the PR). 
   See [this blog post](https://strimzi.io/blog/2021/07/29/how-to-write-blog-posts-for-strimzi-blog/) for a detailed overview of the mechanics of writing a blog post.

   If this is your first blog post, please also add yourself to the [authors.yml](_data/authors.yml) file.

3. We'll do a content review, checking for technical accuracy, logical structure etc.
   Sometimes this can be an iterative process, but we'll try not to keep you waiting. 
   
4. Once the content is good we'll do a final review pass focussing on things like spelling and grammar.
   Don't worry if you're not a native English speaker; our main intent here isn't necessarily _perfect_ English, but to ensure the content is easily understood.

### Diagrams

You can include diagrams by adding images to `assets/images/posts` directory (the filename should start with the date of the post) and linking to them directly. 
Alternatively, you can enable [Mermaid](https://mermaid.js.org/) diagram rendering in you post's markdown. 
To do this add `mermaid: true` to your post's front matter, then tag your diagram code blocks with the `mermaid` language tag:
```markdown
---
layout: post
mermaid: true
---

```mermaid
flowchart TD
A --> B
B --> C
``` `
```

## Quick starts

[Strimzi quick starts](https://strimzi.io/quickstarts/) provide instructions for evaluating Strimzi using _Minikube_, _Kubernetes kind_ or _Docker Desktop_.

The source markdown files for the quick starts are maintained in the [`quickstarts`](/quickstarts) and [`/_includes/quickstarts`](/_includes/quickstarts) folders.

If you spot something that needs updating or changing in the quick starts, you can open an issue or open a PR and contribute directly. 

For more information on contributing to the Strimzi documentation, see the [Strimzi Documentation Contributor Guide](https://strimzi.io/contributing/guide/).

# Contributing

You can contribute by:

* Raising any issues you find using Strimzi
* Fixing issues by opening Pull Requests
* Improving documentation
* Talking about Strimzi

All bugs, tasks or enhancements are tracked as [GitHub issues](https://github.com/strimzi/strimzi-kafka-operator/issues). 
Issues which might be a good start for new contributors are marked with the ["good-start"](https://github.com/strimzi/strimzi-kafka-operator/labels/good-start) label.

The [Development Guide for Strimzi](https://github.com/strimzi/strimzi-kafka-operator/blob/main/development-docs/DEV_GUIDE.md) describes how to build Strimzi and how to test your changes before submitting a patch or opening a PR.

If you want to get in touch with us first before contributing, you can use:

* [#strimzi channel on CNCF Slack](https://slack.cncf.io/)
* [Strimzi Dev mailing list](https://lists.cncf.io/g/cncf-strimzi-dev/topics)

Learn more on how you can contribute on our [Join Us](https://strimzi.io/join-us/) page.



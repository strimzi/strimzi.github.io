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

Once running the website is accessibly at `localhost:4000`.

## Build using a container

To avoid needing to install Ruby you can build and run the web site locally inside a container, run:

    docker run -d -v ${PWD}:/srv/jekyll -p 4000:4000 -it jekyll/jekyll jekyll serve

To see the progress of the build, run:

    docker container ls
    docker logs <ID> -f

It can take several minutes to complete, look for the message "Server running...".

**Note:** If you see the error `require': cannot load such file -- webrick (LoadError)` add the following to the `Gemfile`:

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

3. We'll do a content review, checking for technical accuracy, logical structure etc.
   Sometimes this can be an iterative process, but we'll try not to keep you waiting. 
   
4. Once the content is good we'll do a final review pass focussing on things like spelling and grammar.
   Don't worry if you're not a native English speaker; our main intent here isn't necessarily _perfect_ English, but to ensure the content is easily understood.


const { ApolloServer, gql, UserInputError } = require('apollo-server')
const { v4: uuid } = require("uuid")
const mongoose = require("mongoose")
const Author = require("./models/author")
const Book = require("./models/book")

const MONGODB_URI = "mongodb+srv://fullstack:IpvOr7nesHFdwdah@cluster0.n70j8.mongodb.net/libraryGraphQL?retryWrites=true&w=majority"
console.log(`connecting to ${MONGODB_URI}`)

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true })
  .then(() => {
    console.log("connected to MongoDB")
  })
  .catch((error) => {
    console.log("error connection to MongoDB:", error.message)
  })

const typeDefs = gql`
  type Author {
    name: String!
    born: Int
    bookCount: Int
    id: ID!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String]
    id: ID!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
  }
  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int!
      genres: [String]
    ): Book
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
  }
`

const resolvers = {
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      if (!args.author && !args.genre) {
        return Book.find({})
      }
      let filteredBooks = await Book.find({})
      // if (args.author && !args.genre) {
      //   filteredBooks = await Book.find({ author: { $eq: args.author }})
      // }
      if (args.genre && !args.author) {
        filteredBooks = await Book.find({ genres: { $in: args.genre }})
      }
      // if (args.genre && args.author) {
      //   filteredBooks = await Book.find({ 
      //     genres: { $in: args.genre },
      //     author: { $eq: args.author }
      //   })
      // }
      return filteredBooks
    },
    allAuthors: () => Author.find({}),
  },
  Author: {
    bookCount: (root) => {
      return Book.find({ author: { $eq: root._id }}).countDocuments()
    }
  },
  Mutation: {
    addBook: async (root, args) => {
      if (args.title.length < 2) {
        throw new UserInputError("title too short", {
          invalidArgs: args.title,
        })
      }

      let author = await Author.findOne({ name: args.author })

      if (!author) {
        if (args.author.length < 4) {
          throw new UserInputError("author name too short", {
            invalidArgs: args.author,
          })
        }
        author = new Author({ name: args.author })
        try {
          await author.save()
        } catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }
      }
      try {
        const book = new Book({
          title: args.title,
          author: author._id,
          published: args.published,
          genres: args.genres
        })
        return book.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
    },
    editAuthor: async (root, args) => {
      const authorToChange = await Author.findOne({ name: args.name })
      if (!authorToChange) {
        throw new UserInputError("Author not found", {
          invalidArgs: args.name
        })
      }
      try {
        const updatedAuthor= await Author.findByIdAndUpdate(authorToChange._id, {
          born: args.setBornTo
        })
        return updatedAuthor
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
})

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`)
})
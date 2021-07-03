const { 
  ApolloServer, gql, UserInputError, AuthenticationError, PubSub
} = require('apollo-server')
const { v4: uuid } = require("uuid")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const Author = require("./models/author")
const Book = require("./models/book")
const User = require("./models/libraryUser")
const pubsub = new PubSub()


const JWT_SECRET = "lfdjgn384FDj38fd2ki"
const MONGODB_URI = process.env.MONGODB_URI
console.log(`connecting to ${MONGODB_URI}`)

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true })
  .then(() => {
    console.log("connected to MongoDB")
  })
  .catch((error) => {
    console.log("error connection to MongoDB:", error.message)
  })
mongoose.set('debug', true)

const typeDefs = gql`
  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

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
    me: User
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
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
  }

  type Subscription {
    bookAdded: Book!
  }
`

const resolvers = {
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      if (!args.author && !args.genre) {
        return Book.find({}).populate("author")
      }
      let filteredBooks = await Book.find({})
      if (args.author && !args.genre) {
        const author = await Author.findOne({ name: args.author })
        filteredBooks = await Book.find({ author: { $eq: author._id }}).populate("author")
      }
      if (args.genre && !args.author) {
        filteredBooks = await Book.find({ genres: { $in: args.genre }}).populate("author")
      }
      if (args.genre && args.author) {
        const author = await Author.findOne({ name: args.author })
        filteredBooks = await Book.find({ 
          genres: { $in: args.genre },
          author: { $eq: author._id }
        }).populate("author")
      }
      return filteredBooks
    },
    allAuthors: () => {
      return Author.find({})
    },
    me: (root, args, context) => {
      return context.currentUser
    },
  },
  Author: {
    bookCount: (root) => Book.collection.countDocuments({ author: { $eq: root._id }})
  },
  Mutation: {
    addBook: async (root, args, context) => {
      const currentUser = context.currentUser
      if (!currentUser) {
        throw new AuthenticationError("not logged in")
      }

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
      
      const book = new Book({
        title: args.title,
        author: author._id,
        published: args.published,
        genres: args.genres || []
      })
      try {
        await book.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      book.author = author
      pubsub.publish("BOOK_ADDED", { bookAdded: book })
      return book
    },
    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser
      if (!currentUser) {
        throw new AuthenticationError("not logged in")
      }
      
      const authorToChange = await Author.findOne({ name: args.name })
      if (!authorToChange) {
        throw new UserInputError("Author not found", {
          invalidArgs: args.name
        })
      }
      try {
        const updatedAuthor= await Author.findByIdAndUpdate(
          authorToChange._id, { born: args.setBornTo }, { new:true }
        )
        return updatedAuthor
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
    },
    createUser: (root, args) => {
      const user = new User({ 
        username: args.username, favoriteGenre: args.favoriteGenre
      })
      return user.save()
        .catch(error => {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        })
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })

      if ( !user || args.password !== 'secret' ) {
        throw new UserInputError("wrong credentials")
      }
      const userForToken = {
        username: user.username,
        id: user._id
      }

      return { value: jwt.sign(userForToken, JWT_SECRET) }
    }
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(["BOOK_ADDED"])
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null
    if (auth && auth.toLowerCase().startsWith("bearer ")) {
      const decodedToken = jwt.verify(
        auth.substring(7), JWT_SECRET
      )
      const currentUser = await User.findById(decodedToken.id)
      return { currentUser }
    }
  }
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscriptions ready at ${subscriptionsUrl}`)
})
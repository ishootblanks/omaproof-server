const jwt = require('jsonwebtoken');
const uuidv4 = require('uuid/v4');

async function createUser(root, args, context) {
  // auto generate password:
  args.data.password = uuidv4();
  const user = await context.db.mutation.createUser(
    {
      data: {
        ...args.data
      }
    },
    `{id}`
  );
  const token = jwt.sign(
    { userId: user.id, activeGroup: null },
    process.env.APP_SECRET
  );
  return {
    token,
    user
  };
}

async function login(root, args, context) {
  const user = await context.db.query.user(
    { where: { contactNumber: args.contactNumber } },
    `{id password}`
  );
  if (!user) throw new Error('User not found');
  // const valid = args.password === user.password;
  // if (!valid) throw new Error('Incorrect password');
  const token = jwt.sign(
    { userId: user.id, activeGroup: null },
    process.env.APP_SECRET
  );
  return {
    token,
    user
  };
}

async function selectGroup(parent, args, context) {
  const groups = await context.db.query.groups(
    {
      where: {
        id: args.groupId,
        AND: {
          users_some: {
            id: context.userId
          }
        }
      }
    },
    `{id}`
  );
  const group = groups[0];
  if (!group) throw new Error('GroupId not available for user');
  const signature = { userId: context.userId, activeGroup: args.groupId };
  const token = jwt.sign(signature, process.env.APP_SECRET);
  return {
    token,
    group
  };
}

async function createGroup(parent, args, context) {
  const newUserContactNumbers = [];
  const oldUserContactNumbers = [];
  const admin = { id: context.userId };
  for (let index = 0; index < args.contactNumbers.length; index++) {
    const number = args.contactNumbers[index];
    const user = await context.db.query.user(
      {
        where: {
          contactNumber: number
        }
      },
      `{id}`
    );
    user
      ? oldUserContactNumbers.push({ contactNumber: number })
      : newUserContactNumbers.push({ contactNumber: number });
  }

  const group = await context.db.mutation.createGroup(
    {
      data: {
        ...args.data,
        admin: {
          connect: admin
        },
        users: {
          connect: [admin, ...oldUserContactNumbers],
          create: [...newUserContactNumbers]
        }
      }
    },
    `{id}`
  );
  const signature = {
    userId: context.userId,
    activeGroup: group.id
  };
  const token = jwt.sign(signature, process.env.APP_SECRET);
  return {
    token,
    group
  };
}

// Access verification: it is either the user itself or the admin
async function updateUser(parent, args, context, info) {
  const isUserSelf = context.userId === args.userId;
  const isValidUser = await _verifyUserIsInGroupById(args.userId, context);
  if (!isValidUser) throw new Error('Invalid authorization');
  const isAdmin = await _verifyUserIsAdminById(context);
  if (!isUserSelf && !isAdmin) throw new Error('Invalid authorization');
  return context.db.mutation.updateUser(
    {
      data: {
        ...args.data
      },
      where: {
        id: args.userId
      }
    },
    info
  );
}

async function _verifyUserIsAdminById(context) {
  const group = await context.db.query.group(
    {
      where: {
        id: context.activeGroup
      }
    },
    `{admin {id}}`
  );

  return group.admin.id === context.userId;
}

async function _verifyUserIsInGroupById(userId, context) {
  const user = await context.db.query.user(
    {
      where: {
        id: userId
      }
    },
    `{id groups {id}}`
  );
  if (!user) throw new Error('Invalid');
  return user.groups.find(group => group.id === context.activeGroup);
}

async function createPost(parent, args, context, info) {
  const options = {};
  options.group = { connect: { id: context.activeGroup } };
  options.user = { connect: { id: context.userId } };
  if (args.tags_contactNumbers) {
    options.tags = await _createTags(args.tags_contactNumbers, context);
  }
  return context.db.mutation.createPost(
    {
      data: {
        ...args.content,
        ...options
      }
    },
    info
  );
}

async function _verifyUserIdByContactNumbers(contactNumbers, context) {
  return context.db.query.users(
    {
      where: {
        groups_some: {
          id: context.activeGroup
        },
        AND: {
          contactNumber_in: contactNumbers
        }
      }
    },
    `{contactNumber}`
  );
}

async function _verifyPostId(postId, context) {
  try {
    const posts = await context.db.query.posts(
      {
        where: {
          id: postId,
          AND: {
            group: {
              id: context.activeGroup
            }
          }
        }
      },
      `{id}`
    );
    return !!posts[0];
  } catch (error) {
    throw new Error('Invalid post id');
  }
}

async function createComment(parent, args, context, info) {
  if (!(await _verifyPostId(args.postId, context)))
    throw new Error('Invalid post id');
  const options = {};
  options.post = { connect: { id: args.postId } };
  options.user = { connect: { id: context.userId } };
  if (args.tags_contactNumbers) {
    options.tags = await _createTags(args.tags_contactNumbers, context);
  }
  return context.db.mutation.createComment(
    {
      data: {
        ...args.content,
        ...options
      }
    },
    info
  );
}

async function _createTags(tags_contactNumbers, context) {
  const verifiedIds = await _verifyUserIdByContactNumbers(
    tags_contactNumbers,
    context
  );
  const arr = verifiedIds.map(el => {
    return { user: { connect: { contactNumber: el.contactNumber } } };
  });
  return { create: arr };
}

async function deletePost(parent, args, context, info) {
  const post = await context.db.query.post(
    {
      where: {
        id: args.id
      }
    },
    `{
      id
      group 
        {id}
      user 
        {id}
    }`
  );

  if (context.userId !== post.user.id || context.activeGroup !== post.group.id)
    throw new Error('Invalid');

  return await context.db.mutation.deletePost(
    {
      where: {
        id: args.id
      }
    },
    info
  );
}

async function deleteComment(parent, args, context, info) {
  const comment = await context.db.query.comment(
    {
      where: {
        id: args.id
      }
    },
    `{
      id
      post {
        group 
          {id}
      }
      user 
        {id}
    }`
  );
  if (
    context.userId !== comment.user.id ||
    context.activeGroup !== comment.post.group.id
  ) {
    throw new Error('Invalide');
  } else {
    return await context.db.mutation.deleteComment(
      {
        where: {
          id: args.id
        }
      },
      info
    );
  }
}

async function deleteTag(parent, args, context, info) {
  const tag = await context.db.query.tag(
    {
      where: {
        id: args.id
      }
    },
    `{
      id 
      link_post {id group {id} user {id}} 
      link_comment {id post {group {id}} user {id}} 
    }`
  );
  if (
    (tag.link_post &&
      (tag.link_post.user.id === context.userId &&
        tag.link_post.group.id === context.activeGroup)) ||
    (tag.link_comment &&
      (tag.link_comment.user.id === context.userId &&
        tag.link_comment.post.group.id === context.activeGroup))
  ) {
    return await context.db.mutation.deleteTag(
      {
        where: {
          id: args.id
        }
      },
      info
    );
  } else {
    throw new Error('Invalide');
  }
}

async function deleteUser(parent, args, context, info) {
  if (args.id === context.userId) {
    return await context.db.mutation.deleteUser(
      {
        where: {
          id: args.id
        }
      },
      info
    );
  } else {
    throw new Error('Invalide');
  }
}

async function deleteUserFromGroup(parent, args, context, info) {
  const group = await context.db.query.group(
    {
      where: {
        id: context.activeGroup
      }
    },
    `{id users {id} admin {id}}`
  );
  if (
    group.users.find(user => user.id === args.id) &&
    context.userId === group.admin.id
  ) {
    return await context.db.mutation.updateGroup(
      {
        where: {
          id: context.activeGroup
        },
        data: { users: { disconnect: { id: args.id } } }
      },
      info
    );
  } else {
    throw new Error('Invalide');
  }
}

module.exports = {
  createUser,
  login,
  createGroup,
  selectGroup,
  createPost,
  createComment,
  updateUser,
  deletePost,
  deleteComment,
  deleteTag,
  deleteUser,
  deleteUserFromGroup
};
